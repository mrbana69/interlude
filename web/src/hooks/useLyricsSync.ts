'use client';

import { useEffect, useState, useMemo } from 'react';
import type { PlaybackSyncEvent, Track } from './useSocket.js';

export interface LrcLine {
  timeSec: number;
  text: string;
}

export function parseLrc(lrcText?: string): LrcLine[] {
  if (!lrcText) return [];

  const lines = lrcText.split('\n');
  const result: LrcLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\](.*)/;

  for (const line of lines) {
    const match = timeRegex.exec(line.trim());
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const fraction = match[3] ? parseFloat(`0.${match[3]}`) : 0;
      const timeSec = minutes * 60 + seconds + fraction;
      const text = match[4].trim();
      if (text.length > 0) {
        result.push({ timeSec, text });
      }
    }
  }

  return result.sort((a, b) => a.timeSec - b.timeSec);
}

export function useLyricsSync(
  lrcText: string | undefined,
  syncEvent: PlaybackSyncEvent | null,
  roomOffsetMs = 0,
  localOffsetMs = 0,
  trackMeta?: Partial<Track>
) {
  const [resolvedText, setResolvedText] = useState<string | undefined>(lrcText);
  const [resolvedType, setResolvedType] = useState<'synced' | 'plain' | 'none'>(
    trackMeta?.lyricsType || (lrcText ? 'synced' : 'none')
  );
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);

  // Keep synced with incoming track metadata or fetch from /api/lyrics on-demand if missing
  useEffect(() => {
    setResolvedText(lrcText);
    if (lrcText) {
      setResolvedType(trackMeta?.lyricsType === 'plain' ? 'plain' : 'synced');
      setIsLoadingLyrics(false);
      return;
    }

    if (!trackMeta?.title || !trackMeta?.artist) {
      setResolvedType('none');
      setIsLoadingLyrics(false);
      return;
    }

    let cancelled = false;
    setIsLoadingLyrics(true);
    fetch(
      `/api/lyrics?id=${encodeURIComponent(trackMeta.id || '')}&artist=${encodeURIComponent(trackMeta.artist)}&title=${encodeURIComponent(trackMeta.title)}&duration=${encodeURIComponent(String(trackMeta.durationSec || 180))}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && data.body && data.type !== 'none') {
          setResolvedText(data.body);
          setResolvedType(data.type);
        } else {
          setResolvedType('none');
        }
      })
      .catch(() => {
        if (!cancelled) setResolvedType('none');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLyrics(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lrcText, trackMeta?.id, trackMeta?.title, trackMeta?.artist, trackMeta?.durationSec, trackMeta?.lyricsType]);

  const lines = useMemo(() => parseLrc(resolvedText), [resolvedText]);
  const plainLines = useMemo(() => {
    if (lines.length > 0 || !resolvedText) return [];
    return resolvedText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }, [lines.length, resolvedText]);

  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [interpolatedTime, setInterpolatedTime] = useState(0);

  useEffect(() => {
    let animId: number;

    const tick = () => {
      if (syncEvent && syncEvent.status === 'playing' && lines.length > 0) {
        const elapsed = (Date.now() - syncEvent.hostTimestamp) / 1000;
        const totalOffset = (roomOffsetMs + localOffsetMs) / 1000;
        const currentSec = Math.max(0, syncEvent.positionSec + elapsed + totalOffset);
        setInterpolatedTime(currentSec);

        let found = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].timeSec <= currentSec) {
            found = i;
          } else {
            break;
          }
        }
        setActiveLineIndex(found);
      } else if (syncEvent && syncEvent.status === 'paused' && lines.length > 0) {
        const totalOffset = (roomOffsetMs + localOffsetMs) / 1000;
        const currentSec = Math.max(0, syncEvent.positionSec + totalOffset);
        let found = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].timeSec <= currentSec) found = i;
          else break;
        }
        setActiveLineIndex(found);
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [lines, syncEvent, roomOffsetMs, localOffsetMs]);

  return {
    lines,
    plainLines,
    resolvedType,
    isLoadingLyrics,
    activeLineIndex,
    interpolatedTime,
  };
}
