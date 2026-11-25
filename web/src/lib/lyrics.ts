export type LyricsType = 'synced' | 'plain' | 'none';

const lyricsCache = new Map<string, { type: LyricsType; body: string | null }>();

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
    .replace(/\s*,\s*.*$/, '') // Primary artist before commas
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
  const cacheKey = trackId || `${artist}::${title}`;
  if (lyricsCache.has(cacheKey)) {
    const hit = lyricsCache.get(cacheKey)!;
    if (hit.type !== 'none') return hit;
  }

  const cleanTitle = sanitizeTrackTitle(title) || title;
  const cleanArtist = sanitizeArtist(artist) || artist;
  const headers = { 'User-Agent': 'Interlude/1.0 (https://interlude-five.vercel.app)' };

  // 1. Exact LRCLIB /api/get (raw then sanitized)
  for (const [a, t] of [
    [artist, title],
    [cleanArtist, cleanTitle],
  ]) {
    try {
      const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(a)}&track_name=${encodeURIComponent(t)}${durationSec > 0 ? `&duration=${Math.round(durationSec)}` : ''}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(4500) });
      if (res.ok) {
        const data: any = await res.json();
        if (data?.syncedLyrics) {
          const out = { type: 'synced' as const, body: data.syncedLyrics };
          lyricsCache.set(cacheKey, out);
          return out;
        }
        if (data?.plainLyrics) {
          const out = { type: 'plain' as const, body: data.plainLyrics };
          lyricsCache.set(cacheKey, out);
          return out;
        }
      }
    } catch {}
  }

  // 2. Fuzzy LRCLIB /api/search (handles duration mismatch, remix/featuring variations)
  const searchUrls = [
    `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`,
    `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanArtist} ${cleanTitle}`)}`,
  ];

  for (const url of searchUrls) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(4500) });
      if (res.ok) {
        const results: any[] = await res.json();
        const match = pickBestLrclibMatch(results, durationSec);
        if (match) {
          lyricsCache.set(cacheKey, match);
          return match;
        }
      }
    } catch {}
  }

  // 3. Fallback to NetEase (163 Cloud Music)
  try {
    const query = `${cleanArtist} ${cleanTitle}`;
    const sUrl = `https://music.163.com/api/search/get/web?csrf_token=&type=1&s=${encodeURIComponent(query)}&limit=1`;
    const sRes = await fetch(sUrl, { signal: AbortSignal.timeout(4000) });
    if (sRes.ok) {
      const sData: any = await sRes.json();
      const songId = sData?.result?.songs?.[0]?.id;
      if (songId) {
        const lUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
        const lRes = await fetch(lUrl, { signal: AbortSignal.timeout(4000) });
        if (lRes.ok) {
          const lData: any = await lRes.json();
          const lyricText = lData?.lrc?.lyric;
          if (lyricText && lyricText.includes('[')) {
            const out = { type: 'synced' as const, body: lyricText };
            lyricsCache.set(cacheKey, out);
            return out;
          }
        }
      }
    }
  } catch {}

  return { type: 'none', body: null };
}
