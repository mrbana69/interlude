import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'interlude-web',
    source: 'YouTube Music',
    timestamp: Date.now()
  });
}
