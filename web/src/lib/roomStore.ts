export interface Track {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  coverUrl?: string;
  streamUrl?: string;
  isKaraoke: boolean;
  hasInstrumental: boolean;
  lyricsType: 'synced' | 'plain' | 'none';
  lyricsBody?: string;
  addedBy: {
    guestToken: string;
    nickname: string;
  };
  serverReceivedAt: number;
}

export interface RoomState {
  code: string;
  hostSecret: string;
  status: 'playing' | 'paused' | 'stopped';
  currentTrackId: string | null;
  positionSec: number;
  lastSyncTimestampMs: number;
  crossfadeSec: number;
  lyricsOffsetMs: number;
  queue: Track[];
  history: Track[];
}

const globalRooms = new Map<string, RoomState>();

export function getOrCreateRoom(code: string, hostSecret?: string): RoomState {
  const normalized = code.toUpperCase().trim();
  let room = globalRooms.get(normalized);
  if (!room) {
    room = {
      code: normalized,
      hostSecret: hostSecret || crypto.randomUUID(),
      status: 'stopped',
      currentTrackId: null,
      positionSec: 0,
      lastSyncTimestampMs: Date.now(),
      crossfadeSec: 4,
      lyricsOffsetMs: 0,
      queue: [],
      history: []
    };
    globalRooms.set(normalized, room);
  }
  return room;
}

export function getRoom(code: string): RoomState | null {
  const normalized = code.toUpperCase().trim();
  return globalRooms.get(normalized) || null;
}

export function addTrackToRoomQueue(roomCode: string, track: any, guest: { guestToken: string; nickname: string }) {
  const room = getOrCreateRoom(roomCode);
  const newTrack: Track = {
    id: track.id || crypto.randomUUID(),
    title: track.title || 'Brano',
    artist: track.artist || 'Artista',
    durationSec: track.durationSec || 180,
    coverUrl: track.coverUrl,
    streamUrl: track.streamUrl || `/api/stream/${track.id}`,
    isKaraoke: Boolean(track.isKaraoke),
    hasInstrumental: Boolean(track.hasInstrumental),
    lyricsType: track.lyricsType || 'none',
    lyricsBody: track.lyricsBody,
    addedBy: guest,
    serverReceivedAt: Date.now()
  };

  room.queue.push(newTrack);
  if (!room.currentTrackId) {
    room.currentTrackId = newTrack.id;
    room.status = 'playing';
    room.lastSyncTimestampMs = Date.now();
  }
  return { success: true, room };
}

export function removeTrackFromRoomQueue(roomCode: string, trackId: string) {
  const room = getRoom(roomCode);
  if (!room) return null;
  room.queue = room.queue.filter(t => t.id !== trackId);
  if (room.currentTrackId === trackId) {
    const next = room.queue[0];
    room.currentTrackId = next ? next.id : null;
    room.status = next ? 'playing' : 'stopped';
    room.positionSec = 0;
    room.lastSyncTimestampMs = Date.now();
  }
  return room;
}
