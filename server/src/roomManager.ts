import { randomUUID } from 'node:crypto';
import { getRoomFromDb, saveRoomToDb } from './db.js';
import { resolveLyrics } from './lyrics.js';
import { findInstrumentalOnYTMusic } from './youtubeMusic.js';
import type { RoomState, Track } from './types.js';

const activeRooms = new Map<string, RoomState>();

export function getOrCreateRoom(code: string, hostSecret?: string): RoomState {
  const normalized = code.toUpperCase().trim();
  let room = activeRooms.get(normalized) || getRoomFromDb(normalized);

  if (!room) {
    room = {
      code: normalized,
      hostSecret: hostSecret || randomUUID(),
      status: 'stopped',
      currentTrackId: null,
      positionSec: 0,
      lastSyncTimestampMs: Date.now(),
      crossfadeSec: 4,
      lyricsOffsetMs: 0,
      queue: [],
      history: []
    };
    activeRooms.set(normalized, room);
    saveRoomToDb(room);
  }

  return room;
}

export function getRoom(code: string): RoomState | null {
  const normalized = code.toUpperCase().trim();
  return activeRooms.get(normalized) || getRoomFromDb(normalized);
}

export async function addTrackToQueue(
  roomCode: string,
  trackInput: {
    id: string;
    title: string;
    artist: string;
    durationSec: number;
    coverUrl?: string;
    streamUrl?: string;
    requestInstrumental?: boolean; // Solo se chiede esplicitamente la versione senza voce
    forceNormal?: boolean;
  },
  guest: { guestToken: string; nickname: string }
): Promise<{ success: boolean; track?: Track; error?: string; canFallbackToNormal?: boolean }> {
  const room = getRoom(roomCode);
  if (!room) return { success: false, error: 'Stanza non trovata' };

  // Anti-spam: Max 3 active tracks in queue per guest
  const activeCount = room.queue.filter(t => t.addedBy.guestToken === guest.guestToken).length;
  if (activeCount >= 3) {
    return { success: false, error: 'Limite raggiunto: hai già 3 brani in coda. Attendi che vengano riprodotti!' };
  }

  const wantsInstrumental = !!trackInput.requestInstrumental && !trackInput.forceNormal;
  let activeTrackId = trackInput.id;
  let isKaraoke = false;
  let hasInstrumental = false;

  // Se l'utente ha chiesto la versione senza voce, cercala su YouTube Music
  if (wantsInstrumental) {
    const instRes = await findInstrumentalOnYTMusic(trackInput.artist, trackInput.title, trackInput.durationSec);
    if (instRes.instrumentalId) {
      activeTrackId = instRes.instrumentalId;
      isKaraoke = true;
      hasInstrumental = true;
    } else {
      // Regola Skip: base richiesta ma non trovata su YouTube Music
      return {
        success: false,
        error: 'Base strumentale non trovata su YouTube Music.',
        canFallbackToNormal: true
      };
    }
  }

  // Risoluzione testi (se non c'è il testo, il brano si aggiunge comunque come normale!)
  const lyricsRes = await resolveLyrics(trackInput.id, trackInput.artist, trackInput.title, trackInput.durationSec);

  const newTrack: Track = {
    id: activeTrackId,
    title: trackInput.title,
    artist: trackInput.artist,
    durationSec: trackInput.durationSec,
    coverUrl: trackInput.coverUrl,
    streamUrl: `/api/stream/${activeTrackId}`,
    isKaraoke,
    hasInstrumental,
    lyricsType: lyricsRes.type,
    lyricsBody: lyricsRes.body || undefined,
    addedBy: guest,
    serverReceivedAt: Date.now()
  };

  // FCFS: append to queue
  room.queue.push(newTrack);

  // If nothing is playing, make it current
  if (!room.currentTrackId && room.status === 'stopped') {
    room.currentTrackId = newTrack.id;
  }

  saveRoomToDb(room);
  return { success: true, track: newTrack };
}

export function reorderQueue(roomCode: string, trackId: string, newIndex: number, hostSecret: string): boolean {
  const room = getRoom(roomCode);
  if (!room || room.hostSecret !== hostSecret) return false;

  const currentIndex = room.queue.findIndex(t => t.id === trackId);
  if (currentIndex === -1 || newIndex < 0 || newIndex >= room.queue.length) return false;

  const [track] = room.queue.splice(currentIndex, 1);
  room.queue.splice(newIndex, 0, track);
  saveRoomToDb(room);
  return true;
}

export function removeTrackFromQueue(roomCode: string, trackId: string, requesterSecretOrToken: string): boolean {
  const room = getRoom(roomCode);
  if (!room) return false;

  const trackIndex = room.queue.findIndex(t => t.id === trackId);
  if (trackIndex === -1) return false;

  const track = room.queue[trackIndex];
  const isHost = room.hostSecret === requesterSecretOrToken;
  const isOwner = track.addedBy.guestToken === requesterSecretOrToken;

  if (!isHost && !isOwner) return false;

  room.queue.splice(trackIndex, 1);

  if (room.currentTrackId === trackId) {
    room.currentTrackId = room.queue[0]?.id || null;
    room.positionSec = 0;
    room.lastSyncTimestampMs = Date.now();
  }

  saveRoomToDb(room);
  return true;
}

export function updatePlaybackSync(
  roomCode: string,
  sync: {
    status: 'playing' | 'paused' | 'stopped';
    currentTrackId: string | null;
    positionSec: number;
  },
  hostSecret: string
): boolean {
  const room = getRoom(roomCode);
  if (!room || room.hostSecret !== hostSecret) return false;

  room.status = sync.status;
  room.currentTrackId = sync.currentTrackId;
  room.positionSec = sync.positionSec;
  room.lastSyncTimestampMs = Date.now();

  saveRoomToDb(room);
  return true;
}
