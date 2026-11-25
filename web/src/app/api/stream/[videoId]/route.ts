import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';

function generateSapisidHash(cookieString: string, origin = 'https://music.youtube.com'): string | null {
  if (!cookieString) return null;
  const match = cookieString.match(/(?:__Secure-3PAPISID|SAPISID|__Secure-1PAPISID)=([^;]+)/i);
  const sapisid = match ? match[1].trim() : cookieString.length >= 20 ? cookieString.trim() : null;
  if (!sapisid) return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1').update(`${timestamp} ${sapisid} ${origin}`).digest('hex');
  return `SAPISIDHASH ${timestamp}_${hash}`;
}

async function resolveDirectAudioUrl(videoId: string): Promise<{ url: string; mimeType: string } | null> {
  const cookie = process.env.YTM_COOKIE || process.env.YT_COOKIES || '';
  const sapisidHash = generateSapisidHash(cookie);

  const clients: Array<{ endpoint: string; client: Record<string, any>; headers: Record<string, string> }> = [
    ...(cookie
      ? [
          {
            endpoint: 'https://music.youtube.com/youtubei/v1/player',
            client: { clientName: 'WEB_REMIX', clientVersion: '1.20241101.01.00', hl: 'en', gl: 'US' },
            headers: {
              'Content-Type': 'application/json',
              'Origin': 'https://music.youtube.com',
              'Referer': 'https://music.youtube.com/',
              'Cookie': cookie,
              ...(sapisidHash ? { Authorization: sapisidHash } : {}),
            },
          },
        ]
      : []),
    {
      endpoint: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      client: { clientName: 'ANDROID_VR', clientVersion: '1.50.28', androidSdkVersion: 30, hl: 'en', gl: 'US' },
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://music.youtube.com' },
    },
    {
      endpoint: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      client: { clientName: 'ANDROID_MUSIC', clientVersion: '6.43.52', androidSdkVersion: 34, hl: 'en', gl: 'US' },
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://music.youtube.com' },
    },
  ];

  const results = await Promise.allSettled(
    clients.map(async (entry) => {
      const res = await fetch(entry.endpoint, {
        method: 'POST',
        headers: entry.headers,
        body: JSON.stringify({ context: { client: entry.client }, videoId }),
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      const formats = [...(data?.streamingData?.adaptiveFormats || []), ...(data?.streamingData?.formats || [])];
      const audioFormats = formats.filter((f: any) => f?.mimeType?.startsWith('audio/') && typeof f?.url === 'string');
      if (audioFormats.length === 0) return null;

      audioFormats.sort((a: any, b: any) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
      const chosen = audioFormats[0];
      return {
        url: chosen.url as string,
        mimeType: String(chosen.mimeType).split(';')[0] || 'audio/mp4',
      };
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return null;
}

let ytdlInstance: any = null;
let ytdlQuality: any = null;

async function getYtdlClient() {
  if (!ytdlInstance) {
    const ytdlModule = await import('@distube/ytdl-core');
    const YtdlConstructor = (ytdlModule as any).Ytdl || (ytdlModule as any).default?.Ytdl;
    ytdlQuality = (ytdlModule as any).Quality || (ytdlModule as any).default?.Quality;
    ytdlInstance = new YtdlConstructor();
  }
  return { ytdl: ytdlInstance, Quality: ytdlQuality };
}

function isLocalhostOrPrivate(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch {
    return true;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  if (!videoId) {
    return NextResponse.json({ error: 'videoId mancante' }, { status: 400 });
  }

  const rangeHeader = req.headers.get('range');

  // 1. Proxy to dedicated Fastify backend if SERVER_URL is external/valid
  if (process.env.SERVER_URL && !isLocalhostOrPrivate(process.env.SERVER_URL)) {
    try {
      const backendUrl = new URL(`/api/stream/${encodeURIComponent(videoId)}`, process.env.SERVER_URL);
      const upstreamRes = await fetch(backendUrl.toString(), {
        headers: rangeHeader ? { Range: rangeHeader } : undefined,
        signal: AbortSignal.timeout(5000),
      });
      if (upstreamRes.ok && upstreamRes.body) {
        return new NextResponse(upstreamRes.body as any, {
          status: upstreamRes.status,
          headers: {
            'Content-Type': upstreamRes.headers.get('content-type') || 'audio/webm',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
            ...(upstreamRes.headers.get('content-range')
              ? { 'Content-Range': upstreamRes.headers.get('content-range')! }
              : {}),
            ...(upstreamRes.headers.get('content-length')
              ? { 'Content-Length': upstreamRes.headers.get('content-length')! }
              : {}),
          },
        });
      }
    } catch {}
  }

  // 2. Direct Innertube audio resolution
  const direct = await resolveDirectAudioUrl(videoId);
  if (direct?.url) {
    try {
      const upstreamHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Origin: 'https://music.youtube.com',
        Referer: 'https://music.youtube.com/',
      };
      if (rangeHeader) upstreamHeaders['Range'] = rangeHeader;

      const audioRes = await fetch(direct.url, {
        headers: upstreamHeaders,
        signal: AbortSignal.timeout(8000),
      });

      if (audioRes.ok && audioRes.body) {
        return new NextResponse(audioRes.body as any, {
          status: audioRes.status,
          headers: {
            'Content-Type': direct.mimeType,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
            ...(audioRes.headers.get('content-range')
              ? { 'Content-Range': audioRes.headers.get('content-range')! }
              : {}),
            ...(audioRes.headers.get('content-length')
              ? { 'Content-Length': audioRes.headers.get('content-length')! }
              : {}),
          },
        });
      }
    } catch {}
  }

  // 3. Fallback via @distube/ytdl-core
  try {
    const { ytdl, Quality } = await getYtdlClient();
    const info = await ytdl.getInfo(`https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
    const formats: any[] = Array.isArray(info?.formats) ? info.formats : [];
    const audioOnly = formats
      .filter((f) => f && f.hasAudio && !f.hasVideo && f.url)
      .sort((a, b) => (Number(b.audioBitrate) || Number(b.bitrate) || 0) - (Number(a.audioBitrate) || Number(a.bitrate) || 0));

    if (audioOnly[0]?.url) {
      const chosen = audioOnly[0];
      const upstreamRes = await fetch(chosen.url, {
        headers: rangeHeader ? { Range: rangeHeader } : undefined,
        signal: AbortSignal.timeout(8000),
      });
      if (upstreamRes.ok && upstreamRes.body) {
        const mime = chosen.mimeType ? String(chosen.mimeType).split(';')[0] : 'audio/mp4';
        return new NextResponse(upstreamRes.body as any, {
          status: upstreamRes.status,
          headers: {
            'Content-Type': mime,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
            ...(upstreamRes.headers.get('content-range')
              ? { 'Content-Range': upstreamRes.headers.get('content-range')! }
              : {}),
            ...(upstreamRes.headers.get('content-length')
              ? { 'Content-Length': upstreamRes.headers.get('content-length')! }
              : {}),
          },
        });
      }
    }

    const nodeStream = ytdl.download(info, {
      quality: Quality ? Quality.HighestAudio : undefined,
      filter: { hasAudio: true, hasVideo: false },
    });
    const webStream = Readable.toWeb(nodeStream as any);
    return new NextResponse(webStream as any, {
      status: 200,
      headers: {
        'Content-Type': 'audio/webm',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: any) {
    console.warn(`[Stream Fallback Info] ${videoId}:`, err?.message);
  }

  // 4. Clean fallback response notifying the host deck to use client-side YouTube IFrame Bridge
  return NextResponse.json(
    {
      ok: false,
      error: 'Direct audio stream unavailable from serverless IP',
      fallback: 'youtube-embed',
      videoId,
    },
    { status: 422 }
  );
}
