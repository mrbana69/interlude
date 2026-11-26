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

type ClientProfile = 'web_remix' | 'android_vr' | 'android_music';

const directUrlCache = new Map<string, { url: string; mimeType: string; profile: ClientProfile; expiresAt: number }>();

function getHeadersForProfile(profile: ClientProfile, rangeHeader: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (profile === 'android_vr') {
    headers['User-Agent'] = 'com.google.android.apps.youtube.vr.oculus/1.50.28 (Linux; U; Android 11; en_US) gzip';
  } else if (profile === 'android_music') {
    headers['User-Agent'] = 'com.google.android.apps.youtube.music/6.43.52 (Linux; U; Android 14; en_US) gzip';
  } else {
    headers['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    headers['Origin'] = 'https://music.youtube.com';
    headers['Referer'] = 'https://music.youtube.com/';
  }
  if (rangeHeader) headers['Range'] = rangeHeader;
  return headers;
}

async function fetchWithConnectTimeout(
  url: string,
  init: RequestInit = {},
  connectTimeoutMs = 6000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), connectTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildStreamResponse(upstreamRes: Response, mimeType: string, isHead = false): NextResponse {
  const headers: Record<string, string> = {
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  };
  const contentRange = upstreamRes.headers.get('content-range');
  const contentLength = upstreamRes.headers.get('content-length');
  if (contentRange) headers['Content-Range'] = contentRange;
  if (contentLength) headers['Content-Length'] = contentLength;

  if (isHead) {
    try {
      upstreamRes.body?.cancel();
    } catch {}
    return new NextResponse(null, { status: upstreamRes.status === 206 ? 200 : upstreamRes.status, headers });
  }

  return new NextResponse(upstreamRes.body as any, {
    status: upstreamRes.status,
    headers,
  });
}

async function resolveDirectAudioUrl(
  videoId: string,
  bypassCache = false
): Promise<{ url: string; mimeType: string; profile: ClientProfile } | null> {
  const cached = !bypassCache ? directUrlCache.get(videoId) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return { url: cached.url, mimeType: cached.mimeType, profile: cached.profile };
  }
  const cookie = process.env.YTM_COOKIE || process.env.YT_COOKIES || '';
  const sapisidHash = generateSapisidHash(cookie);

  const clients: Array<{
    profile: ClientProfile;
    endpoint: string;
    client: Record<string, any>;
    headers: Record<string, string>;
  }> = [
    ...(cookie
      ? [
          {
            profile: 'web_remix' as const,
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
      profile: 'android_vr',
      endpoint: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      client: { clientName: 'ANDROID_VR', clientVersion: '1.50.28', androidSdkVersion: 30, hl: 'en', gl: 'US' },
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.apps.youtube.vr.oculus/1.50.28 (Linux; U; Android 11; en_US) gzip',
      },
    },
    {
      profile: 'android_music',
      endpoint: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      client: { clientName: 'ANDROID_MUSIC', clientVersion: '6.43.52', androidSdkVersion: 34, hl: 'en', gl: 'US' },
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.apps.youtube.music/6.43.52 (Linux; U; Android 14; en_US) gzip',
      },
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
        profile: entry.profile,
      };
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      directUrlCache.set(videoId, {
        ...r.value,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      return r.value;
    }
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

async function handleStreamRequest(
  req: NextRequest,
  videoId: string,
  isHead = false
): Promise<NextResponse> {
  if (!videoId || !/^[A-Za-z0-9_-]{6,32}$/.test(videoId)) {
    return NextResponse.json({ error: 'videoId mancante o non valido' }, { status: 400 });
  }

  const rangeHeader = isHead ? 'bytes=0-1' : req.headers.get('range');

  // 1. Proxy to dedicated Fastify backend if SERVER_URL is external/valid
  if (process.env.SERVER_URL && !isLocalhostOrPrivate(process.env.SERVER_URL)) {
    try {
      const backendUrl = new URL(`/api/stream/${encodeURIComponent(videoId)}`, process.env.SERVER_URL);
      const upstreamRes = await fetchWithConnectTimeout(
        backendUrl.toString(),
        { headers: rangeHeader ? { Range: rangeHeader } : undefined },
        5000
      );
      if (upstreamRes.ok && (isHead || upstreamRes.body)) {
        const mime = upstreamRes.headers.get('content-type') || 'audio/webm';
        return buildStreamResponse(upstreamRes, mime, isHead);
      }
    } catch {}
  }

  // 2. Direct Innertube audio resolution (using connect-only timeout so audio stream is never truncated)
  let direct = await resolveDirectAudioUrl(videoId);
  for (let attempt = 0; attempt < 2 && direct?.url; attempt++) {
    try {
      const upstreamHeaders = getHeadersForProfile(direct.profile, rangeHeader);
      const audioRes = await fetchWithConnectTimeout(direct.url, { headers: upstreamHeaders }, 6000);

      if (audioRes.ok && (isHead || audioRes.body)) {
        return buildStreamResponse(audioRes, direct.mimeType, isHead);
      }
      if (audioRes.status === 403 || audioRes.status === 410) {
        directUrlCache.delete(videoId);
        direct = await resolveDirectAudioUrl(videoId, true);
        continue;
      }
      break;
    } catch {
      break;
    }
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
      const mime = chosen.mimeType ? String(chosen.mimeType).split(';')[0] : 'audio/mp4';
      directUrlCache.set(videoId, {
        url: chosen.url,
        mimeType: mime,
        profile: 'web_remix',
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      const upstreamRes = await fetchWithConnectTimeout(
        chosen.url,
        { headers: rangeHeader ? { Range: rangeHeader } : undefined },
        6000
      );
      if (upstreamRes.ok && (isHead || upstreamRes.body)) {
        return buildStreamResponse(upstreamRes, mime, isHead);
      }
    }

    if (isHead) {
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Content-Type': 'audio/webm',
          'Access-Control-Allow-Origin': '*',
        },
      });
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

export async function HEAD(
  req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  return handleStreamRequest(req, videoId, true);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  return handleStreamRequest(req, videoId, false);
}
