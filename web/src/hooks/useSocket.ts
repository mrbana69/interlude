'use client';

import { useEffect, useState, useRef } from 'react';
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
    // In standalone local dev on port 3000, connect directly to backend on 2007
    if (window.location.port === '3000') {
      return `${window.location.protocol}//${window.location.hostname}:2007`;
    }
    // On Vercel (or custom domain), socket.io requests route through same origin via Vercel rewrites
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

  useEffect(() => {
    if (!roomCode) return;

    let guestToken = localStorage.getItem('interlude_guest_token');
    if (!guestToken) {
      guestToken = crypto.randomUUID();
      localStorage.setItem('interlude_guest_token', guestToken);
    }

    let hostSecret = isHost ? localStorage.getItem(`interlude_host_${roomCode}`) : undefined;

    const socket = io(getServerUrl(), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
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

    socket.on('disconnect', (reason) => {
      console.warn('[Socket] Disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', async (err) => {
      console.warn('[Socket] Connection error:', err.message);
      // Fallback: poll HTTP API in serverless deployments
      try {
        const res = await fetch(`/api/rooms?code=${encodeURIComponent(roomCode)}`);
        if (res.ok) {
          const data = await res.json();
          setRoom(data);
          setConnected(true);
        }
      } catch {
        setConnected(false);
      }
    });

    // In case socket fails or disconnects on serverless, fallback interval keeps room in sync
    const fallbackInterval = setInterval(async () => {
      if (!socket.connected) {
        try {
          const res = await fetch(`/api/rooms?code=${encodeURIComponent(roomCode)}`);
          if (res.ok) {
            const data = await res.json();
            setRoom(data);
            setConnected(true);
          }
        } catch {}
      }
    }, 3000);

    socket.on('room:state', (state: RoomState) => {
      setRoom(state);
      if (isHost && state.hostSecret) {
        localStorage.setItem(`interlude_host_${roomCode}`, state.hostSecret);
      }
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
  }, [roomCode, isHost]);

  const addTrack = async (track: any, requestInstrumental = false, forceNormal = false) => {
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
    } else {
      // HTTP API Fallback
      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'queue:add', code: roomCode, track, guestToken, nickname, requestInstrumental, forceNormal })
        });
        if (res.ok) {
          const result = await res.json();
          if (result.room) setRoom(result.room);
        }
      } catch (err: any) {
        console.error('[HTTP Queue Error]:', err);
      }
    }
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

  const sendPlaybackSync = (status: 'playing' | 'paused' | 'stopped', currentTrackId: string | null, positionSec: number) => {
    const hostSecret = localStorage.getItem(`interlude_host_${roomCode}`);
    socketRef.current?.emit('playback:sync', {
      roomCode,
      status,
      currentTrackId,
      positionSec,
      hostSecret
    });
  };

  const sendReaction = (emoji: string) => {
    const nickname = localStorage.getItem('interlude_nickname') || 'Ospite';
    socketRef.current?.emit('reaction:send', { roomCode, emoji, nickname });
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
