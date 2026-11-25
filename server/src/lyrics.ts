import { getCachedTrack, cacheTrack } from './db.js';
import type { LyricsType } from './types.js';

function sanitizeTrackTitle(raw: string): string {
  return (raw || '')
    .replace(/\s*[\(\[]\s*(?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|hd|hq|remastered(?:\s*\d+)?|feat\.?[^)\]]*|ft\.?[^)\]]*|with\s+[^)\]]*|explicit|clean|version|audio|lyrics?)[\)\]]/gi, '')
    .replace(/\s*-\s*(?:remastered|live|acoustic|radio edit).*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeArtist(raw: string): string {
  return (raw || '')
    .replace(/\s*-\s*Topic\b/gi, '')
    .replace(/\s*VEVO\b/gi, '')
    .replace(/\s*Official(?:\s*Channel|\s*Artist\s*Channel)?\b/gi, '')
    .replace(/\s*,\s*.*$/, '')
    .replace(/\s*(?:&|feat\.?|ft\.?|x)\s+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickBestLrclibMatch(results: any[], durationSec: number): { type: LyricsType; body: string } | null {
  if (!Array.isArray(results) || results.length === 0) return null;

  const syncedMatches = results.filter((r) => r && typeof r.syncedLyrics === 'string' && r.syncedLyrics.trim().length > 0);
  if (syncedMatches.length > 0) {
    syncedMatches.sort((a, b) => {
      const diffA = typeof a.duration === 'number' ? Math.abs(a.duration - durationSec) : 999;
      const diffB = typeof b.duration === 'number' ? Math.abs(b.duration - durationSec) : 999;
      return diffA - diffB;
    });
    return { type: 'synced', body: syncedMatches[0].syncedLyrics };
  }

  const plainMatches = results.filter((r) => r && typeof r.plainLyrics === 'string' && r.plainLyrics.trim().length > 0);
  if (plainMatches.length > 0) {
    plainMatches.sort((a, b) => {
      const diffA = typeof a.duration === 'number' ? Math.abs(a.duration - durationSec) : 999;
      const diffB = typeof b.duration === 'number' ? Math.abs(b.duration - durationSec) : 999;
      return diffA - diffB;
    });
    return { type: 'plain', body: plainMatches[0].plainLyrics };
  }

  return null;
}

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

  const cleanTitle = sanitizeTrackTitle(title) || title;
  const cleanArtist = sanitizeArtist(artist) || artist;
  const headers = { 'User-Agent': 'Interlude/1.0 (https://interlude-five.vercel.app)' };

  const persistAndReturn = (type: LyricsType, body: string) => {
    cacheTrack({
      track_id: trackId,
      title,
      artist,
      duration_sec: durationSec,
      lyrics_type: type,
      lyrics_body: body
    });
    return { type, body };
  };

  // 1. Try LRCLIB exact /api/get
  for (const [a, t] of [
    [artist, title],
    [cleanArtist, cleanTitle]
  ]) {
    try {
      const lrcUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(a)}&track_name=${encodeURIComponent(t)}&duration=${Math.round(durationSec)}`;
      const res = await fetch(lrcUrl, { headers, signal: AbortSignal.timeout(4500) });
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data.syncedLyrics) return persistAndReturn('synced', data.syncedLyrics);
        if (data.plainLyrics) return persistAndReturn('plain', data.plainLyrics);
      }
    } catch {}
  }

  // 2. Try LRCLIB fuzzy /api/search
  const searchUrls = [
    `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`,
    `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanArtist} ${cleanTitle}`)}`
  ];
  for (const sUrl of searchUrls) {
    try {
      const res = await fetch(sUrl, { headers, signal: AbortSignal.timeout(4500) });
      if (res.ok) {
        const results = (await res.json()) as any[];
        const best = pickBestLrclibMatch(results, durationSec);
        if (best) return persistAndReturn(best.type, best.body);
      }
    } catch {}
  }

  // 3. Fallback to NetEase (163 Cloud Music)
  try {
    const query = `${cleanArtist} ${cleanTitle}`;
    const sUrl = `https://music.163.com/api/search/get/web?csrf_token=&type=1&s=${encodeURIComponent(query)}&limit=1`;
    const sRes = await fetch(sUrl, { signal: AbortSignal.timeout(4000) });
    if (sRes.ok) {
      const sData = (await sRes.json()) as any;
      const songId = sData?.result?.songs?.[0]?.id;
      if (songId) {
        const lUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
        const lRes = await fetch(lUrl, { signal: AbortSignal.timeout(4000) });
        if (lRes.ok) {
          const lData = (await lRes.json()) as any;
          const lyricText = lData?.lrc?.lyric;
          if (lyricText && lyricText.includes('[')) {
            return persistAndReturn('synced', lyricText);
          }
        }
      }
    }
  } catch {}

  // Do NOT permanently poison SQLite cache with 'none' if transient failure
  return { type: 'none', body: null };
}
