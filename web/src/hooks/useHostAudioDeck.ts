'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Track } from './useSocket.js';

interface DeckSlot {
  trackId: string;
  streamUrl: string;
  audio: HTMLAudioElement;
  sourceNode?: MediaElementAudioSourceNode;
  gainNode?: GainNode;
  cleanupTimers?: () => void;
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
  const persistentAudioRef = useRef<HTMLAudioElement | null>(null);
  const persistentMediaRef = useRef<{ source: MediaElementAudioSourceNode; gain: GainNode } | null>(null);
  const slot1Ref = useRef<DeckSlot | null>(null);
  const prefetchedTrackIdRef = useRef<string | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef<boolean>(false);
  const activeEngineRef = useRef<'native' | 'youtube' | null>(null);
  const autoPlayOnSwitchRef = useRef<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);
  const activeTrackIdRef = useRef<string | null>(currentTrackId);
  const playAttemptRef = useRef<number>(0);
  const probeAbortRef = useRef<AbortController | null>(null);
  const ytTransitionUntilRef = useRef<number>(0);
  const queueRef = useRef<Track[]>(queue);
  const onTrackChangeRef = useRef(onTrackChange);
  const onSyncRef = useRef(onSync);

  queueRef.current = queue;
  onTrackChangeRef.current = onTrackChange;
  onSyncRef.current = onSync;
  isPlayingRef.current = isPlaying;

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  };

  const getPersistentAudio = () => {
    if (!persistentAudioRef.current) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      persistentAudioRef.current = audio;
    }
    const audio = persistentAudioRef.current;
    if (!persistentMediaRef.current) {
      try {
        const ctx = getAudioContext();
        const source = ctx.createMediaElementSource(audio);
        const gain = ctx.createGain();
        source.connect(gain);
        gain.connect(ctx.destination);
        persistentMediaRef.current = { source, gain };
      } catch {}
    } else {
      try {
        getAudioContext();
      } catch {}
    }
    return audio;
  };

  const cleanupNativeSlot1 = () => {
    if (slot1Ref.current) {
      try {
        slot1Ref.current.cleanupTimers?.();
        slot1Ref.current.audio.onended = null;
        slot1Ref.current.audio.ontimeupdate = null;
        slot1Ref.current.audio.onplaying = null;
        slot1Ref.current.audio.onerror = null;
        slot1Ref.current.audio.pause();
      } catch {}
      slot1Ref.current = null;
    }
  };

  const stopAllEngines = () => {
    if (probeAbortRef.current) {
      try {
        probeAbortRef.current.abort();
      } catch {}
      probeAbortRef.current = null;
    }
    cleanupNativeSlot1();
    if (ytPlayerRef.current && ytReadyRef.current) {
      try {
        ytPlayerRef.current.pauseVideo?.();
      } catch {}
    }
    activeEngineRef.current = null;
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
                const loadedId = ytPlayerRef.current?.getVideoData?.()?.video_id;
                if (loadedId && activeTrackIdRef.current && loadedId !== activeTrackIdRef.current) {
                  return;
                }
                if (e.data === 1) {
                  setIsPlaying(true);
                  setIsLoading(false);
                  setPlaybackError(null);
                  const cur = ytPlayerRef.current?.getCurrentTime?.() || 0;
                  const dur = ytPlayerRef.current?.getDuration?.() || 0;
                  setCurrentTime(cur);
                  if (dur > 0) setDuration(dur);
                  onSyncRef.current('playing', activeTrackIdRef.current, cur);
                } else if (e.data === 2) {
                  if (Date.now() < ytTransitionUntilRef.current) return;
                  setIsPlaying(false);
                  const cur = ytPlayerRef.current?.getCurrentTime?.() || 0;
                  onSyncRef.current('paused', activeTrackIdRef.current, cur);
                } else if (e.data === 0) {
                  if (Date.now() < ytTransitionUntilRef.current) return;
                  const cur = ytPlayerRef.current?.getCurrentTime?.() || 0;
                  const dur = ytPlayerRef.current?.getDuration?.() || 0;
                  if (dur > 20 && cur < dur * 0.7) {
                    return;
                  }
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

  // Warm stream URL resolver cache for next track without allocating full audio blobs in RAM
  const prefetchSlot2 = async (track: Track) => {
    if (prefetchedTrackIdRef.current === track.id) return;
    prefetchedTrackIdRef.current = track.id;
    try {
      const streamUrl = track.streamUrl || `/api/stream/${track.id}`;
      await fetch(streamUrl, { method: 'HEAD' });
    } catch {}
  };

  const startYouTubePlayback = useCallback(async (track: Track, attempt: number, startSeconds = 0) => {
    try {
      ytTransitionUntilRef.current = Date.now() + 2000;
      const player = await ensureYouTubePlayer();
      if (playAttemptRef.current !== attempt) return;

      cleanupNativeSlot1();
      activeEngineRef.current = 'youtube';
      setDuration(track.durationSec || 0);
      setCurrentTime(startSeconds);
      player.loadVideoById({ videoId: track.id, startSeconds });
      player.playVideo();

      setTimeout(() => {
        if (playAttemptRef.current === attempt && activeEngineRef.current === 'youtube') {
          setIsLoading(false);
        }
      }, 3500);
    } catch {
      if (playAttemptRef.current === attempt) {
        setIsLoading(false);
        setIsPlaying(false);
        setPlaybackError('Impossibile avviare la riproduzione audio.');
      }
    }
  }, []);

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
      stopAllEngines();
      setIsPlaying(false);
      onSyncRef.current('stopped', null, 0);
    }
  }, []);

  const playTrackByObject = useCallback(async (track: Track) => {
    const attempt = ++playAttemptRef.current;
    setIsLoading(true);
    setPlaybackError(null);
    activeTrackIdRef.current = track.id;

    // 1. Resume existing active native deck if same track
    if (activeEngineRef.current === 'native' && slot1Ref.current?.trackId === track.id) {
      try {
        getAudioContext();
        await slot1Ref.current.audio.play();
        if (playAttemptRef.current !== attempt) return;
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

    stopAllEngines();

    // Fast capability probe (HEAD) streams directly without pre-downloading the entire file
    const streamUrl = track.streamUrl || `/api/stream/${track.id}`;
    let canStreamNative = false;
    const probeController = new AbortController();
    probeAbortRef.current = probeController;
    const probeTimer = setTimeout(() => probeController.abort(), 2500);
    try {
      const res = await fetch(streamUrl, { method: 'HEAD', signal: probeController.signal });
      const contentType = res.headers.get('content-type') || '';
      canStreamNative = res.ok && contentType.startsWith('audio/');
    } catch {
      canStreamNative = false;
    } finally {
      clearTimeout(probeTimer);
      if (probeAbortRef.current === probeController) {
        probeAbortRef.current = null;
      }
    }

    if (playAttemptRef.current !== attempt) return;

    if (canStreamNative) {
      let fellBack = false;
      let startupWatchdog: ReturnType<typeof setTimeout> | null = null;
      const clearWatchdog = () => {
        if (startupWatchdog) {
          clearTimeout(startupWatchdog);
          startupWatchdog = null;
        }
      };

      try {
        const audio = getPersistentAudio();
        audio.onended = null;
        audio.ontimeupdate = null;
        audio.onplaying = null;
        audio.onerror = null;
        audio.pause();
        audio.src = streamUrl;
        audio.currentTime = 0;

        const fallbackToYt = (resumePos = 0) => {
          if (fellBack || playAttemptRef.current !== attempt) return;
          fellBack = true;
          clearWatchdog();
          cleanupNativeSlot1();
          startYouTubePlayback(track, attempt, Math.floor(Math.max(0, resumePos)));
        };

        startupWatchdog = setTimeout(() => {
          fallbackToYt(audio.currentTime || 0);
        }, 4500);

        audio.onplaying = () => {
          if (playAttemptRef.current !== attempt || fellBack) return;
          clearWatchdog();
          activeEngineRef.current = 'native';
          setIsPlaying(true);
          setIsLoading(false);
          setPlaybackError(null);
          const resolvedDur =
            Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (track.durationSec || 0);
          setDuration(resolvedDur);
          onSyncRef.current('playing', track.id, audio.currentTime);
        };

        audio.ontimeupdate = () => {
          if (playAttemptRef.current !== attempt || fellBack) return;
          setCurrentTime(audio.currentTime);
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            setDuration(audio.duration);
          }
        };

        audio.onended = () => {
          if (playAttemptRef.current !== attempt || fellBack) return;
          clearWatchdog();
          const expectedDur =
            Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (track.durationSec || 0);
          // Guard against truncated HTTP streams prematurely advancing to the next song
          if (expectedDur > 20 && audio.currentTime < expectedDur * 0.75) {
            fallbackToYt(audio.currentTime);
            return;
          }
          advanceTrack();
        };

        audio.onerror = () => {
          fallbackToYt(audio.currentTime || 0);
        };

        activeEngineRef.current = 'native';
        slot1Ref.current = {
          trackId: track.id,
          streamUrl,
          audio,
          sourceNode: persistentMediaRef.current?.source,
          gainNode: persistentMediaRef.current?.gain,
          cleanupTimers: clearWatchdog,
        };
        setDuration(track.durationSec || 0);
        setCurrentTime(0);

        await audio.play();

        if (playAttemptRef.current !== attempt) {
          cleanupNativeSlot1();
          return;
        }

        const idx = queueRef.current.findIndex((t) => t.id === track.id);
        const nextTrack = queueRef.current[idx + 1];
        if (nextTrack) prefetchSlot2(nextTrack);
        return;
      } catch {
        clearWatchdog();
        cleanupNativeSlot1();
      }
    }

    // Fallback Engine 2: YouTube IFrame Bridge (runs from Host PC/TV browser IP, bypasses datacenter blocks)
    await startYouTubePlayback(track, attempt, 0);
  }, [advanceTrack, startYouTubePlayback]);

  const playCurrent = async () => {
    const target =
      queueRef.current.find((t) => t.id === activeTrackIdRef.current) ||
      queueRef.current.find((t) => t.id === currentTrackId) ||
      queueRef.current[0];
    if (!target) return;
    await playTrackByObject(target);
  };

  // Automatically trigger playback when currentTrackId advances via skip(), onended, or queue deletion while playing
  useEffect(() => {
    const prevId = activeTrackIdRef.current;
    activeTrackIdRef.current = currentTrackId;
    if (currentTrackId && (autoPlayOnSwitchRef.current || (isPlayingRef.current && prevId !== currentTrackId))) {
      autoPlayOnSwitchRef.current = false;
      const target = queueRef.current.find((t) => t.id === currentTrackId);
      if (target) {
        playTrackByObject(target);
      }
    } else if (!currentTrackId && isPlayingRef.current) {
      playAttemptRef.current += 1;
      stopAllEngines();
      setIsPlaying(false);
      setIsLoading(false);
    }
  }, [currentTrackId, playTrackByObject]);

  useEffect(() => {
    return () => {
      playAttemptRef.current += 1;
      stopAllEngines();
    };
  }, []);

  const pause = () => {
    playAttemptRef.current += 1;
    setIsLoading(false);
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
    } else {
      stopAllEngines();
      setIsPlaying(false);
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

  // Track timeline progress when using YouTube Engine 2 (also recovers if state=1 event was missed)
  useEffect(() => {
    const timer = setInterval(() => {
      if (activeEngineRef.current === 'youtube' && ytPlayerRef.current && ytReadyRef.current) {
        try {
          const state = ytPlayerRef.current.getPlayerState?.();
          if (state === 1) {
            const cur = ytPlayerRef.current.getCurrentTime?.() || 0;
            const dur = ytPlayerRef.current.getDuration?.() || 0;
            if (!isPlayingRef.current) {
              setIsPlaying(true);
              setIsLoading(false);
              onSyncRef.current('playing', activeTrackIdRef.current, cur);
            }
            setCurrentTime(cur);
            if (dur > 0) setDuration(dur);
          }
        } catch {}
      }
    }, 300);
    return () => clearInterval(timer);
  }, []);

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
