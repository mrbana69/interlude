import path from 'node:path';
import type { RoomState, LyricsType } from './types.js';

export interface CachedTrack {
  track_id: string;
  title: string;
  artist: string;
  duration_sec: number;
  cover_url?: string;
  has_instrumental: number;
  instrumental_id?: string;
  lyrics_type: LyricsType;
  lyrics_body?: string;
  checked_at: number;
}

// Resilient in-memory fallback stores
const memoryTracks = new Map<string, CachedTrack>();
const memoryRooms = new Map<string, RoomState>();

let sqliteDb: any = null;
let getTrackStmt: any = null;
let insertTrackStmt: any = null;
let getRoomStmt: any = null;
let saveRoomStmt: any = null;

try {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = process.env.VERCEL
    ? path.join('/tmp', 'interlude.db')
    : path.resolve('interlude.db');

  sqliteDb = new DatabaseSync(dbPath);
  try {
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    sqliteDb.exec('PRAGMA synchronous = NORMAL;');
  } catch {}

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS track_cache (
      track_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      cover_url TEXT,
      has_instrumental INTEGER DEFAULT 0,
      instrumental_id TEXT,
      lyrics_type TEXT DEFAULT 'none',
      lyrics_body TEXT,
      checked_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      host_secret TEXT NOT NULL,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  getTrackStmt = sqliteDb.prepare('SELECT * FROM track_cache WHERE track_id = ?');
  insertTrackStmt = sqliteDb.prepare(`
    INSERT INTO track_cache (track_id, title, artist, duration_sec, cover_url, has_instrumental, instrumental_id, lyrics_type, lyrics_body, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(track_id) DO UPDATE SET
      has_instrumental = excluded.has_instrumental,
      instrumental_id = excluded.instrumental_id,
      lyrics_type = excluded.lyrics_type,
      lyrics_body = excluded.lyrics_body,
      checked_at = excluded.checked_at
  `);

  getRoomStmt = sqliteDb.prepare('SELECT * FROM rooms WHERE code = ?');
  saveRoomStmt = sqliteDb.prepare(`
    INSERT INTO rooms (code, host_secret, state_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `);
  console.log('[DB] SQLite initialized successfully at', dbPath);
} catch (err: any) {
  console.warn('[DB] SQLite disabled or failed, using memory store fallback:', err?.message);
}

export function getCachedTrack(trackId: string): CachedTrack | undefined {
  if (getTrackStmt) {
    try {
      const row = getTrackStmt.get(trackId) as CachedTrack | undefined;
      if (row) return row;
    } catch (e) {
      console.error('[DB] getCachedTrack error:', e);
    }
  }
  return memoryTracks.get(trackId);
}

export function cacheTrack(track: {
  track_id: string;
  title: string;
  artist: string;
  duration_sec: number;
  cover_url?: string;
  has_instrumental?: boolean;
  instrumental_id?: string;
  lyrics_type: LyricsType;
  lyrics_body?: string;
}) {
  const item: CachedTrack = {
    track_id: track.track_id,
    title: track.title,
    artist: track.artist,
    duration_sec: track.duration_sec,
    cover_url: track.cover_url,
    has_instrumental: track.has_instrumental ? 1 : 0,
    instrumental_id: track.instrumental_id,
    lyrics_type: track.lyrics_type,
    lyrics_body: track.lyrics_body,
    checked_at: Date.now()
  };
  memoryTracks.set(track.track_id, item);

  if (insertTrackStmt) {
    try {
      insertTrackStmt.run(
        track.track_id,
        track.title,
        track.artist,
        track.duration_sec,
        track.cover_url || null,
        track.has_instrumental ? 1 : 0,
        track.instrumental_id || null,
        track.lyrics_type,
        track.lyrics_body || null,
        Date.now()
      );
    } catch (e) {
      console.error('[DB] cacheTrack error:', e);
    }
  }
}

export function getRoomFromDb(code: string): RoomState | null {
  if (getRoomStmt) {
    try {
      const row = getRoomStmt.get(code) as { code: string; host_secret: string; state_json: string } | undefined;
      if (row) {
        return JSON.parse(row.state_json);
      }
    } catch (e) {
      console.error('[DB] getRoomFromDb error:', e);
    }
  }
  return memoryRooms.get(code) || null;
}

export function saveRoomToDb(room: RoomState) {
  memoryRooms.set(room.code, room);
  if (saveRoomStmt) {
    try {
      saveRoomStmt.run(room.code, room.hostSecret, JSON.stringify(room), Date.now());
    } catch (e) {
      console.error('[DB] saveRoomToDb error:', e);
    }
  }
}
