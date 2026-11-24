import YTMusic from 'ytmusic-api';

let ytmusicPromise: Promise<any> | null = null;

export function formatThumb(rawUrl?: string, size = 180): string {
  if (!rawUrl) return '';
  let str = String(rawUrl).trim();
  if (str.includes('googleusercontent.com') || str.includes('ggpht.com')) {
    str = str.replace(/=[ws]\d+.*$/, `=w${size}-h${size}-l90-rj`);
    if (!str.includes(`=w${size}-h${size}-l90-rj`) && !str.includes('=')) {
      str += `=w${size}-h${size}-l90-rj`;
    }
    return str;
  }
  if (str.includes('i.ytimg.com')) {
    return str.replace(/\/default\.jpg/, '/hqdefault.jpg')
      .replace(/\/mqdefault\.jpg/, '/hqdefault.jpg');
  }
  return str;
}

export function formatArtistName(rawName?: string): string {
  if (!rawName) return 'Artista';
  let clean = rawName.trim();
  clean = clean.replace(/\s*-\s*Topic\b/gi, '');
  clean = clean.replace(/Topic$/i, '');
  clean = clean.replace(/\s*VEVO\b/gi, '');
  clean = clean.replace(/VEVO$/i, '');
  clean = clean.replace(/\s*Official(?:\s*Channel|\s*Artist\s*Channel)?\b/gi, '');
  clean = clean.replace(/\s*-\s*Official$/gi, '');
  clean = clean.replace(/\s*Records\b/gi, '');
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean || 'Artista';
}

export async function getYTMusicClient() {
  if (!ytmusicPromise) {
    ytmusicPromise = (async () => {
      const Constructor: any = typeof YTMusic === 'function' ? YTMusic : (YTMusic as any).default;
      const client = new Constructor();
      await client.initialize();
      return client;
    })().catch(err => {
      ytmusicPromise = null;
      throw err;
    });
  }
  return ytmusicPromise;
}

export async function searchYouTubeMusic(query: string) {
  try {
    const client = await getYTMusicClient();
    const songs = await client.searchSongs(query);

    return (songs || [])
      .filter((song: any) => song && (song.videoId || song.id))
      .slice(0, 15)
      .map((song: any) => {
        const trackId = song.videoId || song.id;
        const rawArtist = song.artist?.name || (Array.isArray(song.artists) && song.artists.map((a: any) => a.name).join(', ')) || 'Artista';
        const cleanArtist = formatArtistName(rawArtist);

        const thumbs = Array.isArray(song.thumbnails) ? song.thumbnails : [];
        const rawCover = thumbs[1]?.url || thumbs[0]?.url || (thumbs.length > 0 ? thumbs[thumbs.length - 1]?.url : '');
        const directCover = formatThumb(rawCover, 180);
        const coverUrl = directCover ? `/api/cover-proxy?url=${encodeURIComponent(directCover)}` : '';

        return {
          id: trackId,
          title: song.name || 'Brano senza titolo',
          artist: cleanArtist,
          durationSec: song.duration || 180,
          coverUrl,
          streamUrl: `/api/stream/${trackId}`
        };
      });
  } catch (err) {
    console.error('[YTMusic Search Error]:', err);
    return [];
  }
}
