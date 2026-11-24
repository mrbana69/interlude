import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateRoom } from '@/lib/roomStore';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const code = body.code || `PARTY-${Math.floor(10 + Math.random() * 90)}`;
    const room = getOrCreateRoom(code);
    return NextResponse.json(room);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
