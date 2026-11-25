import fs from 'node:fs';
import path from 'node:path';
import { resolveLyrics } from './lyrics';
import { findInstrumentalOnYTMusic } from './youtubeMusic';

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

export interface ReactionItem {
  id: string;
  emoji: string;
  nickname: string;
  timestamp: number;
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
  reactions?: ReactionItem[];
}

const ROOMS_DISK_PATH = path.join('/tmp', 'interlude-rooms-v1.json');

const globalForRooms = globalThis as unknown as {
  __interludeRooms?: Map<string, RoomState>;
};

const globalRooms: Map<string, RoomState> =
  globalForRooms.__interludeRooms || new Map<string, RoomState>();
globalForRooms.__interludeRooms = globalRooms;

function hydrateFromDisk() {
  try {
    if (fs.existsSync(ROOMS_DISK_PATH)) {
      const raw = fs.readFileSync(ROOMS_DISK_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, RoomState>;
      for (const [k, v] of Object.entries(parsed)) {
        if (!globalRooms.has(k)) {
          globalRooms.set(k, v);
        }
      }
    }
  } catch {}
}

function persistToDisk() {
  try {
    const obj: Record<string, RoomState> = {};
    for (const [k, v] of globalRooms.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(ROOMS_DISK_PATH, JSON.stringify(obj), 'utf8');
  } catch {}
}

hydrateFromDisk();

export function getOrCreateRoom(code: string, hostSecret?: string): RoomState {
  hydrateFromDisk();
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
      history: [],
      reactions: []
    };
    globalRooms.set(normalized, room);
    persistToDisk();
  }
  if (!room.reactions) {
    room.reactions = [];
  }
  return room;
}

export function getRoom(code: string): RoomState | null {
  hydrateFromDisk();
  const normalized = code.toUpperCase().trim();
  return globalRooms.get(normalized) || null;
}

export async function addTrackToRoomQueue(
  roomCode: string,
  track: any,
  guest: { guestToken: string; nickname: string }
): Promise<{ success: boolean; track?: Track; room?: RoomState; error?: string; canFallbackToNormal?: boolean }> {
  const room = getOrCreateRoom(roomCode);

  const wantsInstrumental = Boolean(track.requestInstrumental) && !Boolean(track.forceNormal);
  let activeTrackId = track.id || crypto.randomUUID();
  let isKaraoke = Boolean(track.isKaraoke);
  let hasInstrumental = Boolean(track.hasInstrumental);

  if (wantsInstrumental) {
    const instRes = await findInstrumentalOnYTMusic(
      track.artist || 'Artista',
      track.title || 'Brano',
      track.durationSec || 180
    );
    if (instRes.instrumentalId) {
      activeTrackId = instRes.instrumentalId;
      isKaraoke = true;
      hasInstrumental = true;
    } else {
      return {
        success: false,
        error: 'Base strumentale non trovata su YouTube Music.',
        canFallbackToNormal: true
      };
    }
  }

  let lyricsType: 'synced' | 'plain' | 'none' = track.lyricsType || 'none';
  let lyricsBody: string | undefined = track.lyricsBody;

  if (!lyricsBody || lyricsType === 'none') {
    const resolved = await resolveLyrics(
      track.id || activeTrackId,
      track.artist || '',
      track.title || '',
      track.durationSec || 180
    );
    lyricsType = resolved.type;
    lyricsBody = resolved.body || undefined;
  }

  const newTrack: Track = {
    id: activeTrackId,
    title: track.title || 'Brano',
    artist: track.artist || 'Artista',
    durationSec: track.durationSec || 180,
    coverUrl: track.coverUrl,
    streamUrl: `/api/stream/${activeTrackId}`,
    isKaraoke,
    hasInstrumental,
    lyricsType,
    lyricsBody,
    addedBy: guest,
    serverReceivedAt: Date.now()
  };

  room.queue.push(newTrack);
  if (!room.currentTrackId) {
    room.currentTrackId = newTrack.id;
    room.status = 'stopped';
    room.positionSec = 0;
    room.lastSyncTimestampMs = Date.now();
  }
  persistToDisk();
  return { success: true, track: newTrack, room };
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
  persistToDisk();
  return room;
}

export function updateRoomPlaybackSync(
  roomCode: string,
  sync: {
    status: 'playing' | 'paused' | 'stopped';
    currentTrackId: string | null;
    positionSec: number;
  }
) {
  const room = getOrCreateRoom(roomCode);
  room.status = sync.status;
  if (sync.currentTrackId !== undefined) {
    room.currentTrackId = sync.currentTrackId;
  }
  room.positionSec = Number.isFinite(sync.positionSec) ? sync.positionSec : 0;
  room.lastSyncTimestampMs = Date.now();
  persistToDisk();
  return room;
}

export function addReactionToRoom(roomCode: string, emoji: string, nickname: string): ReactionItem {
  const room = getOrCreateRoom(roomCode);
  const reaction: ReactionItem = {
    id: crypto.randomUUID(),
    emoji,
    nickname: nickname || 'Ospite',
    timestamp: Date.now()
  };
  if (!room.reactions) room.reactions = [];
  room.reactions = [...room.reactions.slice(-25), reaction];
  persistToDisk();
  return reaction;
}
