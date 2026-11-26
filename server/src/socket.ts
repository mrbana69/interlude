import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'node:http';
import { getOrCreateRoom, getRoom, addTrackToQueue, removeTrackFromQueue, reorderQueue, updatePlaybackSync } from './roomManager.js';

let ioInstance: SocketIOServer | null = null;

export function setupSocketIO(server: HTTPServer) {
  if (ioInstance) return ioInstance;

  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
  });
  ioInstance = io;

  io.on('connection', (socket) => {
    socket.on('room:join', ({ roomCode, guestToken, nickname, hostSecret }) => {
      if (!roomCode) return;
      const normalizedCode = roomCode.toUpperCase().trim();
      socket.join(normalizedCode);

      const room = getOrCreateRoom(normalizedCode, hostSecret);
      socket.emit('room:state', room);
    });

    socket.on('queue:add', async ({ roomCode, track, guestToken, nickname, requestInstrumental, forceNormal }) => {
      if (!roomCode || !track || !guestToken) return;
      const res = await addTrackToQueue(
        roomCode,
        { ...track, requestInstrumental, forceNormal },
        { guestToken, nickname: nickname || 'Ospite' }
      );

      if (res.success) {
        const room = getRoom(roomCode);
        io.to(roomCode.toUpperCase()).emit('room:state', room);
      } else {
        socket.emit('queue:error', {
          message: res.error,
          canFallbackToNormal: res.canFallbackToNormal,
          track
        });
      }
    });

    socket.on('queue:remove', ({ roomCode, trackId, tokenOrSecret }) => {
      if (!roomCode || !trackId) return;
      const ok = removeTrackFromQueue(roomCode, trackId, tokenOrSecret);
      if (ok) {
        const room = getRoom(roomCode);
        io.to(roomCode.toUpperCase()).emit('room:state', room);
      }
    });

    socket.on('queue:reorder', ({ roomCode, trackId, newIndex, hostSecret }) => {
      if (!roomCode || !trackId) return;
      const ok = reorderQueue(roomCode, trackId, newIndex, hostSecret);
      if (ok) {
        const room = getRoom(roomCode);
        io.to(roomCode.toUpperCase()).emit('room:state', room);
      }
    });

    // Host heartbeat & playback sync (broadcasted to stage and guests)
    socket.on('playback:sync', ({ roomCode, status, currentTrackId, positionSec, hostSecret }) => {
      if (!roomCode || !hostSecret) return;
      const prevRoom = getRoom(roomCode);
      const trackOrStatusChanged =
        !prevRoom || prevRoom.currentTrackId !== currentTrackId || prevRoom.status !== status;
      const ok = updatePlaybackSync(roomCode, { status, currentTrackId, positionSec }, hostSecret);
      if (ok) {
        const roomKey = roomCode.toUpperCase();
        const serverNowMs = Date.now();
        socket.to(roomKey).emit('playback:sync', {
          status,
          currentTrackId,
          positionSec,
          hostTimestamp: serverNowMs,
          serverNowMs
        });
        if (trackOrStatusChanged) {
          const updatedRoom = getRoom(roomCode);
          if (updatedRoom) {
            io.to(roomKey).emit('room:state', { ...updatedRoom, serverNowMs });
          }
        }
      }
    });

    // Guest reactions (fire emoji, cheers, applause) -> broadcast to TV Stage & Host
    socket.on('reaction:send', ({ roomCode, emoji, nickname }) => {
      if (!roomCode || !emoji) return;
      io.to(roomCode.toUpperCase()).emit('reaction:received', {
        id: Math.random().toString(36).substring(2, 9),
        emoji,
        nickname: nickname || 'Ospite',
        timestamp: Date.now()
      });
    });
  });

  return io;
}
