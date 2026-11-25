import { NextRequest, NextResponse } from 'next/server';
import { resolveLyrics } from '@/lib/lyrics';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id') || '';
  const artist = searchParams.get('artist') || '';
  const title = searchParams.get('title') || '';
  const durationSec = Number(searchParams.get('duration') || '0');

  if (!title && !artist) {
    return NextResponse.json({ type: 'none', body: null }, { status: 400 });
  }

  const res = await resolveLyrics(id, artist, title, durationSec);
  return NextResponse.json(res);
}
