import { NextRequest, NextResponse } from 'next/server';
import { addTrackToRoomQueue, removeTrackFromRoomQueue } from '@/lib/roomStore';

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = await req.json().catch(() => ({}));
  const { track, guestToken, nickname } = body;

  if (!track) {
    return NextResponse.json({ error: 'Track missing' }, { status: 400 });
  }

  const res = addTrackToRoomQueue(code, track, {
    guestToken: guestToken || 'anon',
    nickname: nickname || 'Ospite'
  });

  return NextResponse.json(res);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { searchParams } = new URL(req.url);
  const trackId = searchParams.get('trackId');

  if (!trackId) {
    return NextResponse.json({ error: 'trackId missing' }, { status: 400 });
  }

  const room = removeTrackFromRoomQueue(code, trackId);
  return NextResponse.json({ success: true, room });
}
