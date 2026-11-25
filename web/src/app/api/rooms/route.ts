import { NextRequest, NextResponse } from 'next/server';
import {
  getRoom,
  getOrCreateRoom,
  addTrackToRoomQueue,
  removeTrackFromRoomQueue,
  updateRoomPlaybackSync,
  addReactionToRoom
} from '@/lib/roomStore';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) {
    return NextResponse.json({ error: 'Code missing' }, { status: 400 });
  }
  const room = getRoom(code) || getOrCreateRoom(code);
  return NextResponse.json(room);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const code = body.code || `PARTY-${Math.floor(10 + Math.random() * 90)}`;

    if (body.action === 'reaction:send') {
      const { emoji, nickname } = body;
      const reaction = addReactionToRoom(code, emoji, nickname);
      return NextResponse.json({ success: true, reaction });
    }

    if (body.action === 'queue:add') {
      const { track, guestToken, nickname, requestInstrumental, forceNormal } = body;
      const res = await addTrackToRoomQueue(
        code,
        { ...track, requestInstrumental, forceNormal },
        {
          guestToken: guestToken || 'anon',
          nickname: nickname || 'Ospite'
        }
      );
      return NextResponse.json(res);
    }

    if (body.action === 'queue:remove') {
      const { trackId } = body;
      const room = removeTrackFromRoomQueue(code, trackId);
      return NextResponse.json({ success: true, room });
    }

    if (body.action === 'playback:sync') {
      const { status, currentTrackId, positionSec } = body;
      const room = updateRoomPlaybackSync(code, { status, currentTrackId, positionSec });
      return NextResponse.json({ success: true, room });
    }

    const room = getOrCreateRoom(code, body.hostSecret);
    return NextResponse.json(room);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
