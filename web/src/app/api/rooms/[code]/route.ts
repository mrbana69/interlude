import { NextRequest, NextResponse } from 'next/server';
import { getRoom, getOrCreateRoom } from '@/lib/roomStore';

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!code) {
    return NextResponse.json({ error: 'Code missing' }, { status: 400 });
  }
  const room = getRoom(code) || getOrCreateRoom(code);
  return NextResponse.json(room);
}
