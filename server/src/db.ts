import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { RoomState, Track, LyricsType } from './types.js';

const dbPath = path.resolve('interlude.db');
export const db = new DatabaseSync(dbPath);

// Enable WAL mode for concurrency and performance
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');

db.exec(`
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

const getTrackStmt = db.prepare('SELECT * FROM track_cache WHERE track_id = ?');
const insertTrackStmt = db.prepare(`
  INSERT INTO track_cache (track_id, title, artist, duration_sec, cover_url, has_instrumental, instrumental_id, lyrics_type, lyrics_body, checked_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(track_id) DO UPDATE SET
    has_instrumental = excluded.has_instrumental,
    instrumental_id = excluded.instrumental_id,
    lyrics_type = excluded.lyrics_type,
    lyrics_body = excluded.lyrics_body,
    checked_at = excluded.checked_at
`);

const getRoomStmt = db.prepare('SELECT * FROM rooms WHERE code = ?');
const saveRoomStmt = db.prepare(`
  INSERT INTO rooms (code, host_secret, state_json, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(code) DO UPDATE SET
    state_json = excluded.state_json,
    updated_at = excluded.updated_at
`);

export function getCachedTrack(trackId: string): CachedTrack | undefined {
  return getTrackStmt.get(trackId) as CachedTrack | undefined;
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
}

export function getRoomFromDb(code: string): RoomState | null {
  const row = getRoomStmt.get(code) as { code: string; host_secret: string; state_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.state_json);
  } catch {
    return null;
  }
}

export function saveRoomToDb(room: RoomState) {
  saveRoomStmt.run(room.code, room.hostSecret, JSON.stringify(room), Date.now());
}
