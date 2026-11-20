'use client';

import { useEffect, useState, useMemo } from 'react';
import type { PlaybackSyncEvent } from './useSocket.js';

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
  localOffsetMs = 0
) {
  const lines = useMemo(() => parseLrc(lrcText), [lrcText]);
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [interpolatedTime, setInterpolatedTime] = useState(0);

  useEffect(() => {
    let animId: number;

    const tick = () => {
      if (syncEvent && syncEvent.status === 'playing') {
        const elapsed = (Date.now() - syncEvent.hostTimestamp) / 1000;
        const totalOffset = (roomOffsetMs + localOffsetMs) / 1000;
        const currentSec = Math.max(0, syncEvent.positionSec + elapsed + totalOffset);
        setInterpolatedTime(currentSec);

        // Find active line
        let found = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].timeSec <= currentSec) {
            found = i;
          } else {
            break;
          }
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
    activeLineIndex,
    interpolatedTime
  };
}
