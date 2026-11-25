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
  crossfadeSec: number;
  lyricsOffsetMs: number;
  queue: Track[];
  history: Track[];
}

export interface PlaybackSyncEvent {
  status: 'playing' | 'paused' | 'stopped';
  currentTrackId: string | null;
  positionSec: number;
  hostTimestamp: number;
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

  const syncFromRoomSnapshot = useCallback((data: RoomState) => {
    setRoom(data);
    if (isHost && data.hostSecret) {
      localStorage.setItem(`interlude_host_${roomCode}`, data.hostSecret);
    }
    setLastSync({
      status: data.status,
      currentTrackId: data.currentTrackId,
      positionSec: data.positionSec || 0,
      hostTimestamp: data.lastSyncTimestampMs || Date.now()
    });
  }, [isHost, roomCode]);

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
            if (Array.isArray(data.reactions) && data.reactions.length > 0) {
              setReactions(data.reactions);
            }
            setConnected(true);
          }
        } catch {}
      }
    }, 2000);

    socket.on('room:state', (state: RoomState) => {
      syncFromRoomSnapshot(state);
    });

    socket.on('playback:sync', (sync: PlaybackSyncEvent) => {
      setLastSync(sync);
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
  }, [roomCode, isHost, syncFromRoomSnapshot]);

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
        if (data?.room) setRoom(data.room);
      }).catch(() => {});
    }
  }, [roomCode]);

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
