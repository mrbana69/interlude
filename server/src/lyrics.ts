import { getCachedTrack, cacheTrack } from './db.js';
import type { LyricsType } from './types.js';

export async function resolveLyrics(
  trackId: string,
  artist: string,
  title: string,
  durationSec: number
): Promise<{ type: LyricsType; body: string | null }> {
  // Check SQLite cache first
  const cached = getCachedTrack(trackId);
  if (cached && cached.lyrics_type !== 'none' && cached.lyrics_body) {
    return { type: cached.lyrics_type, body: cached.lyrics_body };
  }

  // 1. Try LRCLIB (open source, accurate time sync)
  try {
    const lrcUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}&duration=${durationSec}`;
    const res = await fetch(lrcUrl, { headers: { 'User-Agent': 'Interlude/1.0' } });
    if (res.ok) {
      const data = (await res.json()) as any;
      if (data.syncedLyrics) {
        cacheTrack({
          track_id: trackId,
          title,
          artist,
          duration_sec: durationSec,
          lyrics_type: 'synced',
          lyrics_body: data.syncedLyrics
        });
        return { type: 'synced', body: data.syncedLyrics };
      }
      if (data.plainLyrics) {
        cacheTrack({
          track_id: trackId,
          title,
          artist,
          duration_sec: durationSec,
          lyrics_type: 'plain',
          lyrics_body: data.plainLyrics
        });
        return { type: 'plain', body: data.plainLyrics };
      }
    }
  } catch {}

  // 2. Fallback to NetEase (163 Cloud Music - vast database with .lrc)
  try {
    const query = `${artist} ${title}`;
    const sUrl = `https://music.163.com/api/search/get/web?csrf_token=&type=1&s=${encodeURIComponent(query)}&limit=1`;
    const sRes = await fetch(sUrl);
    if (sRes.ok) {
      const sData = (await sRes.json()) as any;
      const songId = sData?.result?.songs?.[0]?.id;
      if (songId) {
        const lUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
        const lRes = await fetch(lUrl);
        if (lRes.ok) {
          const lData = (await lRes.json()) as any;
          const lyricText = lData?.lrc?.lyric;
          if (lyricText && lyricText.includes('[')) {
            cacheTrack({
              track_id: trackId,
              title,
              artist,
              duration_sec: durationSec,
              lyrics_type: 'synced',
              lyrics_body: lyricText
            });
            return { type: 'synced', body: lyricText };
          }
        }
      }
    }
  } catch {}

  // None found
  cacheTrack({
    track_id: trackId,
    title,
    artist,
    duration_sec: durationSec,
    lyrics_type: 'none',
    lyrics_body: undefined
  });
  return { type: 'none', body: null };
}
