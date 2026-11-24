import { NextRequest, NextResponse } from 'next/server';
import { searchYouTubeMusic } from '@/lib/youtubeMusic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q');
    if (!q || !q.trim()) {
      return NextResponse.json([]);
    }

    // If internal backend binding SERVER_URL is provided, we can fetch from it or do direct search
    if (process.env.SERVER_URL) {
      try {
        const backendRes = await fetch(new URL(`/search?q=${encodeURIComponent(q.trim())}`, process.env.SERVER_URL), {
          signal: AbortSignal.timeout(3000)
        });
        if (backendRes.ok) {
          const data = await backendRes.json();
          return NextResponse.json(data);
        }
      } catch {}
    }

    const results = await searchYouTubeMusic(q.trim());
    return NextResponse.json(results);
  } catch (err: any) {
    console.error('[API Search Error]:', err);
    return NextResponse.json([], { status: 200 });
  }
}
