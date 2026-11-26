import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_IMAGE_HOST_SUFFIXES = [
  '.ytimg.com',
  'i.ytimg.com',
  '.googleusercontent.com',
  '.ggpht.com',
  '.youtube.com',
];

function isAllowedCoverUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_IMAGE_HOST_SUFFIXES.some((suffix) =>
      suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');
  if (!targetUrl || !isAllowedCoverUrl(targetUrl)) {
    return NextResponse.json({ error: 'Parametro url mancante o non consentito' }, { status: 400 });
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!upstreamRes.ok) {
      return NextResponse.json({ error: 'Errore download copertina' }, { status: upstreamRes.status });
    }

    const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
    const buffer = await upstreamRes.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=604800, immutable'
      }
    });
  } catch {
    return NextResponse.json({ error: 'Impossibile scaricare immagine da upstream' }, { status: 502 });
  }
}
