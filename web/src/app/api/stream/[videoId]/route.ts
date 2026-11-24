import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  if (!videoId) {
    return NextResponse.json({ error: 'videoId mancante' }, { status: 400 });
  }

  // Se è configurato un backend dedicato (SERVER_URL), instradiamo lo stream audio
  if (process.env.SERVER_URL) {
    try {
      const backendUrl = new URL(`/api/stream/${videoId}`, process.env.SERVER_URL);
      const upstreamRes = await fetch(backendUrl.toString());
      if (upstreamRes.ok && upstreamRes.body) {
        return new NextResponse(upstreamRes.body as any, {
          status: 200,
          headers: {
            'Content-Type': upstreamRes.headers.get('content-type') || 'audio/webm',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    } catch (err: any) {
      console.warn('[Stream Proxy Error]:', err?.message);
    }
  }

  // Fallback: reindirizza o restituisce errore informativo
  return NextResponse.json(
    { error: 'Audio streaming proxy disponibile tramite server dedicato o player YouTube' },
    { status: 501 }
  );
}
