'use client';

import { useEffect, useRef, useState } from 'react';
import type { Track } from './useSocket.js';

interface DeckSlot {
  trackId: string;
  blobUrl: string;
  audio: HTMLAudioElement;
  sourceNode: MediaElementAudioSourceNode;
  gainNode: GainNode;
}

export function useHostAudioDeck(
  queue: Track[],
  currentTrackId: string | null,
  onTrackChange: (newTrackId: string) => void,
  onSync: (status: 'playing' | 'paused' | 'stopped', trackId: string | null, positionSec: number) => void
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const slot1Ref = useRef<DeckSlot | null>(null);
  const slot2Ref = useRef<{ trackId: string; blobUrl: string } | null>(null);
  const syncIntervalRef = useRef<any>(null);

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  // Pre-fetch Slot #2 (Up Next) in background (RAM limited to max 2 Blobs)
  const prefetchSlot2 = async (track: Track) => {
    if (slot2Ref.current?.trackId === track.id) return;
    if (slot2Ref.current) {
      URL.revokeObjectURL(slot2Ref.current.blobUrl);
      slot2Ref.current = null;
    }

    try {
      const streamUrl = track.streamUrl || `/api/stream/${track.id}`;
      const res = await fetch(streamUrl);
      if (res.ok) {
        const blob = await res.blob();
        slot2Ref.current = {
          trackId: track.id,
          blobUrl: URL.createObjectURL(blob)
        };
      }
    } catch {}
  };

  // Play current track
  const playCurrent = async () => {
    const currentTrack = queue.find(t => t.id === currentTrackId) || queue[0];
    if (!currentTrack) return;

    const ctx = getAudioContext();

    // If slot 1 has the right track, just play
    if (slot1Ref.current && slot1Ref.current.trackId === currentTrack.id) {
      slot1Ref.current.audio.play();
      setIsPlaying(true);
      return;
    }

    // Cleanup old slot 1
    if (slot1Ref.current) {
      slot1Ref.current.audio.pause();
      URL.revokeObjectURL(slot1Ref.current.blobUrl);
      slot1Ref.current = null;
    }

    let blobUrl = '';
    if (slot2Ref.current?.trackId === currentTrack.id) {
      blobUrl = slot2Ref.current.blobUrl;
      slot2Ref.current = null;
    } else {
      const streamUrl = currentTrack.streamUrl || `/api/stream/${currentTrack.id}`;
      const res = await fetch(streamUrl);
      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);
    }

    const audio = new Audio(blobUrl);
    const sourceNode = ctx.createMediaElementSource(audio);
    const gainNode = ctx.createGain();

    sourceNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    audio.onended = () => {
      advanceTrack();
    };

    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration || 0);
    };

    await audio.play();
    setIsPlaying(true);

    slot1Ref.current = {
      trackId: currentTrack.id,
      blobUrl,
      audio,
      sourceNode,
      gainNode
    };

    // Pre-fetch next track in queue (#2)
    const nextTrack = queue.find(t => t.id !== currentTrack.id);
    if (nextTrack) {
      prefetchSlot2(nextTrack);
    }
  };

  const pause = () => {
    if (slot1Ref.current) {
      slot1Ref.current.audio.pause();
      setIsPlaying(false);
      onSync('paused', slot1Ref.current.trackId, slot1Ref.current.audio.currentTime);
    }
  };

  const advanceTrack = () => {
    const currentIndex = queue.findIndex(t => t.id === currentTrackId);
    const nextTrack = queue[currentIndex + 1];

    if (nextTrack) {
      onTrackChange(nextTrack.id);
    } else {
      setIsPlaying(false);
      onSync('stopped', null, 0);
    }
  };

  // Heartbeat sync every 2 seconds
  useEffect(() => {
    syncIntervalRef.current = setInterval(() => {
      if (slot1Ref.current && isPlaying) {
        onSync('playing', slot1Ref.current.trackId, slot1Ref.current.audio.currentTime);
      }
    }, 2000);

    return () => clearInterval(syncIntervalRef.current);
  }, [isPlaying, onSync]);

  return {
    isPlaying,
    currentTime,
    duration,
    play: playCurrent,
    pause,
    skip: advanceTrack
  };
}
