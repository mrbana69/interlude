'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export interface Track {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  coverUrl?: string;
  streamUrl?: string;
  isKaraoke: boolean;
  hasInstrumental: boolean;
  lyricsType: 'synced' | 'plain' | 'none';
  lyricsBody?: string;
  addedBy: {
    guestToken: string;
    nickname: string;
  };
  serverReceivedAt: number;
}

export interface RoomState {
  code: string;
  hostSecret: string;
  status: 'playing' | 'paused' | 'stopped';
  currentTrackId: string | null;
  positionSec: number;
  lastSyncTimestampMs: number;
  serverNowMs?: number;
  crossfadeSec: number;
  lyricsOffsetMs: number;
  queue: Track[];
  history: Track[];
  reactions?: ReactionEvent[];
}

export interface PlaybackSyncEvent {
  status: 'playing' | 'paused' | 'stopped';
  currentTrackId: string | null;
  positionSec: number;
  hostTimestamp: number;
  serverNowMs?: number;
}

export interface ReactionEvent {
  id: string;
  emoji: string;
  nickname: string;
  timestamp: number;
}

export interface QueueErrorEvent {
  message: string;
  canFallbackToNormal?: boolean;
  track?: any;
}

const getServerUrl = () => {
  if (typeof window !== 'undefined') {
    if (process.env.NEXT_PUBLIC_SOCKET_URL) return process.env.NEXT_PUBLIC_SOCKET_URL;
    if (window.location.port === '3000') {
      return `${window.location.protocol}//${window.location.hostname}:2007`;
    }
    return window.location.origin;
  }
  return process.env.SERVER_URL || 'http://localhost:2007';
};

export function useRoomSocket(roomCode: string, isHost = false) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState<PlaybackSyncEvent | null>(null);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const [queueError, setQueueError] = useState<QueueErrorEvent | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const lastSyncRef = useRef<PlaybackSyncEvent | null>(null);

  const isSameRoomMeaningfully = (prev: RoomState | null, next: RoomState) => {
    if (!prev) return false;
    if (
      prev.code !== next.code ||
      prev.status !== next.status ||
      prev.currentTrackId !== next.currentTrackId ||
      prev.crossfadeSec !== next.crossfadeSec ||
      prev.lyricsOffsetMs !== next.lyricsOffsetMs ||
      prev.queue.length !== next.queue.length
    ) {
      return false;
    }
    for (let i = 0; i < next.queue.length; i++) {
      if (
        prev.queue[i]?.id !== next.queue[i]?.id ||
        prev.queue[i]?.lyricsType !== next.queue[i]?.lyricsType ||
        prev.queue[i]?.lyricsBody !== next.queue[i]?.lyricsBody
      ) {
        return false;
      }
    }
    return true;
  };

  const applyNormalizedSync = useCallback((incoming: PlaybackSyncEvent, force = false) => {
    const prev = lastSyncRef.current;
    if (!force && prev && prev.status === incoming.status && prev.currentTrackId === incoming.currentTrackId) {
      if (incoming.status === 'playing') {
        const expectedPos = prev.positionSec + Math.max(0, (Date.now() - prev.hostTimestamp) / 1000);
        const drift = Math.abs(expectedPos - incoming.positionSec);
        if (drift < 0.75) {
          return;
        }
      } else if (Math.abs(prev.positionSec - incoming.positionSec) < 0.25) {
        return;
      }
    }
    lastSyncRef.current = incoming;
    setLastSync(incoming);
  }, []);

  const syncFromRoomSnapshot = useCallback((data: RoomState) => {
    setRoom((prev) => (isSameRoomMeaningfully(prev, data) ? prev : data));
    if (Array.isArray(data.reactions) && data.reactions.length > 0) {
      setReactions((prev) => {
        if (
          prev.length === data.reactions!.length &&
          prev[prev.length - 1]?.id === data.reactions![data.reactions!.length - 1]?.id
        ) {
          return prev;
        }
        return data.reactions!;
      });
    }
    if (isHost && data.hostSecret) {
      localStorage.setItem(`interlude_host_${roomCode}`, data.hostSecret);
    }

    // Host drives its own clock via useHostAudioDeck/sendPlaybackSync; avoid polling overwriting live position
    if (isHost && lastSyncRef.current) {
      return;
    }

    const refNowMs = data.serverNowMs || Date.now();
    const serverAgeSec =
      data.status === 'playing' && data.lastSyncTimestampMs
        ? Math.max(0, Math.min(30, (refNowMs - data.lastSyncTimestampMs) / 1000))
        : 0;
    const normalizedPos = (data.positionSec || 0) + serverAgeSec;

    applyNormalizedSync({
      status: data.status,
      currentTrackId: data.currentTrackId,
      positionSec: normalizedPos,
      hostTimestamp: Date.now(),
    });
  }, [applyNormalizedSync, isHost, roomCode]);

  useEffect(() => {
    if (!roomCode) return;

    let guestToken = localStorage.getItem('interlude_guest_token');
    if (!guestToken) {
      guestToken = crypto.randomUUID();
      localStorage.setItem('interlude_guest_token', guestToken);
    }

    const hostSecret = isHost ? localStorage.getItem(`interlude_host_${roomCode}`) : undefined;

    // Immediate HTTP initial hydration so UI never waits for websocket timeout on Vercel
    fetch(`/api/rooms?code=${encodeURIComponent(roomCode)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.code) {
          syncFromRoomSnapshot(data);
          setConnected(true);
        }
      })
      .catch(() => {});

    const socket = io(getServerUrl(), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 5000,
      timeout: 6000
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('room:join', {
        roomCode,
        guestToken,
        nickname: localStorage.getItem('interlude_nickname') || 'Ospite',
        hostSecret
      });
    });

    socket.on('disconnect', () => {
      // Keep polling active without flagging UI red if HTTP works
    });

    socket.on('connect_error', async () => {
      try {
        const res = await fetch(`/api/rooms?code=${encodeURIComponent(roomCode)}`);
        if (res.ok) {
          const data = await res.json();
          syncFromRoomSnapshot(data);
          setConnected(true);
        }
      } catch {
        setConnected(false);
      }
    });

    // Polling fallback when Socket.IO is disconnected (e.g. serverless deployment)
    const fallbackInterval = setInterval(async () => {
      if (!socket.connected) {
        try {
          const res = await fetch(`/api/rooms?code=${encodeURIComponent(roomCode)}`);
          if (res.ok) {
            const data = await res.json();
            syncFromRoomSnapshot(data);
            setConnected(true);
          }
        } catch {}
      }
    }, 2500);

    socket.on('room:state', (state: RoomState) => {
      syncFromRoomSnapshot(state);
    });

    socket.on('playback:sync', (sync: PlaybackSyncEvent) => {
      const serverAgeSec =
        sync.status === 'playing' && sync.serverNowMs && sync.hostTimestamp
          ? Math.max(0, Math.min(5, (sync.serverNowMs - sync.hostTimestamp) / 1000))
          : 0;

      setRoom((prev) => {
        if (!prev) return prev;
        if (prev.status === sync.status && prev.currentTrackId === sync.currentTrackId) {
          return prev;
        }
        return {
          ...prev,
          status: sync.status,
          currentTrackId: sync.currentTrackId !== undefined ? sync.currentTrackId : prev.currentTrackId,
          positionSec: sync.positionSec,
        };
      });

      applyNormalizedSync(
        {
          status: sync.status,
          currentTrackId: sync.currentTrackId,
          positionSec: (sync.positionSec || 0) + serverAgeSec,
          hostTimestamp: Date.now(),
        },
        true
      );
    });

    socket.on('reaction:received', (reaction: ReactionEvent) => {
      setReactions(prev => [...prev.slice(-20), reaction]);
    });

    socket.on('queue:error', (err: QueueErrorEvent) => {
      setQueueError(err);
    });

    return () => {
      clearInterval(fallbackInterval);
      socket.disconnect();
    };
  }, [roomCode, isHost, syncFromRoomSnapshot, applyNormalizedSync]);

  const addTrack = async (track: any, requestInstrumental = false, forceNormal = false): Promise<boolean> => {
    const guestToken = localStorage.getItem('interlude_guest_token') || 'anon';
    const nickname = localStorage.getItem('interlude_nickname') || 'Ospite';
    if (socketRef.current?.connected) {
      socketRef.current.emit('queue:add', {
        roomCode,
        track,
        guestToken,
        nickname,
        requestInstrumental,
        forceNormal
      });
      return true;
    }

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'queue:add', code: roomCode, track, guestToken, nickname, requestInstrumental, forceNormal })
      });
      if (res.ok) {
        const result = await res.json();
        if (result.success === false) {
          setQueueError({
            message: result.error || 'Impossibile aggiungere il brano',
            canFallbackToNormal: result.canFallbackToNormal,
            track
          });
          return false;
        }
        if (result.room) {
          setRoom(result.room);
        }
        return true;
      }
    } catch (err: any) {
      console.error('[HTTP Queue Error]:', err);
    }
    return false;
  };

  const removeTrack = async (trackId: string) => {
    const tokenOrSecret = isHost
      ? localStorage.getItem(`interlude_host_${roomCode}`)
      : localStorage.getItem('interlude_guest_token');
    if (socketRef.current?.connected) {
      socketRef.current.emit('queue:remove', { roomCode, trackId, tokenOrSecret });
    } else {
      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'queue:remove', code: roomCode, trackId, tokenOrSecret })
        });
        if (res.ok) {
          const result = await res.json();
          if (result.room) setRoom(result.room);
        }
      } catch {}
    }
  };

  const reorder = (trackId: string, newIndex: number) => {
    const hostSecret = localStorage.getItem(`interlude_host_${roomCode}`);
    socketRef.current?.emit('queue:reorder', { roomCode, trackId, newIndex, hostSecret });
  };

  const sendPlaybackSync = useCallback((status: 'playing' | 'paused' | 'stopped', currentTrackId: string | null, positionSec: number) => {
    const localSync: PlaybackSyncEvent = {
      status,
      currentTrackId,
      positionSec,
      hostTimestamp: Date.now(),
    };
    setRoom((prev) => {
      if (!prev) return prev;
      if (prev.status === status && prev.currentTrackId === currentTrackId) {
        return prev;
      }
      return {
        ...prev,
        status,
        currentTrackId,
        positionSec,
      };
    });
    applyNormalizedSync(localSync, status !== 'playing' || lastSyncRef.current?.currentTrackId !== currentTrackId);

    const hostSecret = localStorage.getItem(`interlude_host_${roomCode}`);
    if (socketRef.current?.connected) {
      socketRef.current.emit('playback:sync', {
        roomCode,
        status,
        currentTrackId,
        positionSec,
        hostSecret
      });
    } else {
      fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'playback:sync', code: roomCode, status, currentTrackId, positionSec, hostSecret })
      }).then((r) => (r.ok ? r.json() : null)).then((data) => {
        if (data?.room) {
          setRoom((prev) => (isSameRoomMeaningfully(prev, data.room) ? prev : data.room));
        }
      }).catch(() => {});
    }
  }, [applyNormalizedSync, roomCode]);

  const sendReaction = (emoji: string) => {
    const nickname = localStorage.getItem('interlude_nickname') || 'Ospite';
    if (socketRef.current?.connected) {
      socketRef.current.emit('reaction:send', { roomCode, emoji, nickname });
    }
    setReactions(prev => [
      ...prev.slice(-20),
      { id: crypto.randomUUID(), emoji, nickname, timestamp: Date.now() }
    ]);
    fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reaction:send', code: roomCode, emoji, nickname })
    }).catch(() => {});
  };

  return {
    room,
    connected,
    lastSync,
    reactions,
    queueError,
    clearError: () => setQueueError(null),
    addTrack,
    removeTrack,
    reorder,
    sendPlaybackSync,
    sendReaction
  };
}
