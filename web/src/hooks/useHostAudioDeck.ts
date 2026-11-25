'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Track } from './useSocket.js';

interface DeckSlot {
  trackId: string;
  blobUrl: string;
  audio: HTMLAudioElement;
  sourceNode: MediaElementAudioSourceNode;
  gainNode: GainNode;
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export function useHostAudioDeck(
  queue: Track[],
  currentTrackId: string | null,
  onTrackChange: (newTrackId: string) => void,
  onSync: (status: 'playing' | 'paused' | 'stopped', trackId: string | null, positionSec: number) => void
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const slot1Ref = useRef<DeckSlot | null>(null);
  const slot2Ref = useRef<{ trackId: string; blobUrl: string } | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef<boolean>(false);
  const activeEngineRef = useRef<'native' | 'youtube' | null>(null);
  const autoPlayOnSwitchRef = useRef<boolean>(false);
  const activeTrackIdRef = useRef<string | null>(currentTrackId);
  const queueRef = useRef<Track[]>(queue);
  const onTrackChangeRef = useRef(onTrackChange);
  const onSyncRef = useRef(onSync);

  queueRef.current = queue;
  onTrackChangeRef.current = onTrackChange;
  onSyncRef.current = onSync;

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  };

  const cleanupNativeSlot1 = () => {
    if (slot1Ref.current) {
      try {
        slot1Ref.current.audio.pause();
        slot1Ref.current.audio.onended = null;
        slot1Ref.current.audio.ontimeupdate = null;
        URL.revokeObjectURL(slot1Ref.current.blobUrl);
      } catch {}
      slot1Ref.current = null;
    }
  };

  const ensureYouTubePlayer = (): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (ytPlayerRef.current && ytReadyRef.current) {
        resolve(ytPlayerRef.current);
        return;
      }

      let container = document.getElementById('interlude-yt-bridge');
      if (!container) {
        container = document.createElement('div');
        container.id = 'interlude-yt-bridge';
        container.style.cssText =
          'position:fixed;bottom:0;right:0;width:64px;height:64px;opacity:0.01;pointer-events:none;z-index:-1;overflow:hidden;';
        document.body.appendChild(container);
      }

      const initPlayer = () => {
        try {
          if (ytPlayerRef.current) {
            if (ytReadyRef.current) resolve(ytPlayerRef.current);
            return;
          }
          ytPlayerRef.current = new window.YT.Player('interlude-yt-bridge', {
            height: '64',
            width: '64',
            playerVars: {
              autoplay: 1,
              controls: 0,
              playsinline: 1,
              disablekb: 1,
              fs: 0,
              rel: 0,
              enablejsapi: 1,
            },
            events: {
              onReady: () => {
                ytReadyRef.current = true;
                resolve(ytPlayerRef.current);
              },
              onStateChange: (e: any) => {
                if (activeEngineRef.current !== 'youtube') return;
                if (e.data === 1) {
                  setIsPlaying(true);
                  setIsLoading(false);
                  setPlaybackError(null);
                  const dur = ytPlayerRef.current?.getDuration?.() || 0;
                  if (dur > 0) setDuration(dur);
                } else if (e.data === 2) {
                  setIsPlaying(false);
                } else if (e.data === 0) {
                  advanceTrack();
                }
              },
              onError: () => {
                if (activeEngineRef.current !== 'youtube') return;
                setIsLoading(false);
                setPlaybackError('Traccia non riproducibile su YouTube.');
              },
            },
          });
        } catch (err) {
          reject(err);
        }
      };

      if (window.YT && window.YT.Player) {
        initPlayer();
      } else {
        const prevReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (prevReady) prevReady();
          initPlayer();
        };
        if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
          const tag = document.createElement('script');
          tag.src = 'https://www.youtube.com/iframe_api';
          document.head.appendChild(tag);
        }
        setTimeout(() => {
          if (!ytReadyRef.current) reject(new Error('YouTube API timeout'));
        }, 8000);
      }
    });
  };

  // Pre-fetch Slot #2 (Up Next) in background if direct audio stream works
  const prefetchSlot2 = async (track: Track) => {
    if (slot2Ref.current?.trackId === track.id) return;
    if (slot2Ref.current) {
      URL.revokeObjectURL(slot2Ref.current.blobUrl);
      slot2Ref.current = null;
    }

    try {
      const streamUrl = track.streamUrl || `/api/stream/${track.id}`;
      const res = await fetch(streamUrl);
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.startsWith('audio/')) {
        const blob = await res.blob();
        slot2Ref.current = {
          trackId: track.id,
          blobUrl: URL.createObjectURL(blob),
        };
      }
    } catch {}
  };

  const advanceTrack = useCallback(() => {
    const q = queueRef.current;
    const currentId = activeTrackIdRef.current;
    const currentIndex = q.findIndex((t) => t.id === currentId);
    const nextTrack = currentIndex >= 0 ? q[currentIndex + 1] : q[0];

    if (nextTrack) {
      autoPlayOnSwitchRef.current = true;
      onTrackChangeRef.current(nextTrack.id);
    } else {
      autoPlayOnSwitchRef.current = false;
      setIsPlaying(false);
      onSyncRef.current('stopped', null, 0);
    }
  }, []);

  const playTrackByObject = useCallback(async (track: Track) => {
    setIsLoading(true);
    setPlaybackError(null);
    activeTrackIdRef.current = track.id;

    // 1. Resume existing active native deck if same track
    if (activeEngineRef.current === 'native' && slot1Ref.current?.trackId === track.id) {
      try {
        getAudioContext();
        await slot1Ref.current.audio.play();
        setIsPlaying(true);
        setIsLoading(false);
        onSyncRef.current('playing', track.id, slot1Ref.current.audio.currentTime);
        return;
      } catch {}
    }

    // 2. Resume existing active YouTube deck if same track
    if (activeEngineRef.current === 'youtube' && ytPlayerRef.current && ytReadyRef.current) {
      try {
        const videoData = ytPlayerRef.current.getVideoData?.();
        if (videoData?.video_id === track.id) {
          ytPlayerRef.current.playVideo();
          setIsPlaying(true);
          setIsLoading(false);
          onSyncRef.current('playing', track.id, ytPlayerRef.current.getCurrentTime?.() || 0);
          return;
        }
      } catch {}
    }

    cleanupNativeSlot1();

    // Try Engine 1: Native Audio via /api/stream/[id]
    let nativeBlobUrl = '';
    if (slot2Ref.current?.trackId === track.id) {
      nativeBlobUrl = slot2Ref.current.blobUrl;
      slot2Ref.current = null;
    } else {
      try {
        const streamUrl = track.streamUrl || `/api/stream/${track.id}`;
        const res = await fetch(streamUrl, { signal: AbortSignal.timeout(7000) });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.startsWith('audio/')) {
          const blob = await res.blob();
          nativeBlobUrl = URL.createObjectURL(blob);
        }
      } catch {}
    }

    if (nativeBlobUrl) {
      try {
        const ctx = getAudioContext();
        if (ytPlayerRef.current && ytReadyRef.current) {
          try {
            ytPlayerRef.current.pauseVideo();
          } catch {}
        }

        const audio = new Audio(nativeBlobUrl);
        const sourceNode = ctx.createMediaElementSource(audio);
        const gainNode = ctx.createGain();
        sourceNode.connect(gainNode);
        gainNode.connect(ctx.destination);

        audio.onended = () => advanceTrack();
        audio.ontimeupdate = () => {
          setCurrentTime(audio.currentTime);
          setDuration(audio.duration || track.durationSec || 0);
        };

        await audio.play();
        activeEngineRef.current = 'native';
        slot1Ref.current = { trackId: track.id, blobUrl: nativeBlobUrl, audio, sourceNode, gainNode };
        setIsPlaying(true);
        setIsLoading(false);
        setDuration(track.durationSec || 0);
        onSyncRef.current('playing', track.id, 0);

        const idx = queueRef.current.findIndex((t) => t.id === track.id);
        const nextTrack = queueRef.current[idx + 1];
        if (nextTrack) prefetchSlot2(nextTrack);
        return;
      } catch {
        URL.revokeObjectURL(nativeBlobUrl);
      }
    }

    // Fallback Engine 2: YouTube IFrame Bridge (runs from Host PC/TV browser IP, bypasses datacenter blocks)
    try {
      const player = await ensureYouTubePlayer();
      activeEngineRef.current = 'youtube';
      setDuration(track.durationSec || 0);
      setCurrentTime(0);
      player.loadVideoById(track.id);
      player.playVideo();
      setIsPlaying(true);
      setIsLoading(false);
      onSyncRef.current('playing', track.id, 0);
    } catch {
      setIsLoading(false);
      setIsPlaying(false);
      setPlaybackError('Impossibile avviare la riproduzione audio.');
    }
  }, [advanceTrack]);

  const playCurrent = async () => {
    const target =
      queueRef.current.find((t) => t.id === activeTrackIdRef.current) ||
      queueRef.current.find((t) => t.id === currentTrackId) ||
      queueRef.current[0];
    if (!target) return;
    await playTrackByObject(target);
  };

  // Automatically trigger playback when currentTrackId advances via skip() or onended
  useEffect(() => {
    activeTrackIdRef.current = currentTrackId;
    if (currentTrackId && autoPlayOnSwitchRef.current) {
      autoPlayOnSwitchRef.current = false;
      const target = queueRef.current.find((t) => t.id === currentTrackId);
      if (target) {
        playTrackByObject(target);
      }
    }
  }, [currentTrackId, playTrackByObject]);

  const pause = () => {
    if (activeEngineRef.current === 'native' && slot1Ref.current) {
      slot1Ref.current.audio.pause();
      setIsPlaying(false);
      onSyncRef.current('paused', slot1Ref.current.trackId, slot1Ref.current.audio.currentTime);
    } else if (activeEngineRef.current === 'youtube' && ytPlayerRef.current && ytReadyRef.current) {
      try {
        ytPlayerRef.current.pauseVideo();
      } catch {}
      setIsPlaying(false);
      onSyncRef.current('paused', activeTrackIdRef.current, ytPlayerRef.current.getCurrentTime?.() || currentTime);
    }
  };

  const seek = (timeSec: number) => {
    const target = Math.max(0, Math.min(timeSec, duration || 0));
    if (activeEngineRef.current === 'native' && slot1Ref.current && isFinite(timeSec)) {
      slot1Ref.current.audio.currentTime = target;
      setCurrentTime(target);
      onSyncRef.current(isPlaying ? 'playing' : 'paused', slot1Ref.current.trackId, target);
    } else if (activeEngineRef.current === 'youtube' && ytPlayerRef.current && ytReadyRef.current && isFinite(timeSec)) {
      try {
        ytPlayerRef.current.seekTo(target, true);
      } catch {}
      setCurrentTime(target);
      onSyncRef.current(isPlaying ? 'playing' : 'paused', activeTrackIdRef.current, target);
    }
  };

  // Track timeline progress when using YouTube Engine 2
  useEffect(() => {
    const timer = setInterval(() => {
      if (activeEngineRef.current === 'youtube' && ytPlayerRef.current && ytReadyRef.current && isPlaying) {
        try {
          const cur = ytPlayerRef.current.getCurrentTime?.() || 0;
          const dur = ytPlayerRef.current.getDuration?.() || 0;
          setCurrentTime(cur);
          if (dur > 0) setDuration(dur);
        } catch {}
      }
    }, 300);
    return () => clearInterval(timer);
  }, [isPlaying]);

  // Heartbeat sync every 2 seconds
  useEffect(() => {
    const syncTimer = setInterval(() => {
      if (!isPlaying) return;
      if (activeEngineRef.current === 'native' && slot1Ref.current) {
        onSyncRef.current('playing', slot1Ref.current.trackId, slot1Ref.current.audio.currentTime);
      } else if (activeEngineRef.current === 'youtube' && ytPlayerRef.current && ytReadyRef.current) {
        const cur = ytPlayerRef.current.getCurrentTime?.() || 0;
        onSyncRef.current('playing', activeTrackIdRef.current, cur);
      }
    }, 2000);
    return () => clearInterval(syncTimer);
  }, [isPlaying]);

  return {
    isPlaying,
    isLoading,
    playbackError,
    currentTime,
    duration,
    play: playCurrent,
    pause,
    skip: advanceTrack,
    seek,
  };
}
