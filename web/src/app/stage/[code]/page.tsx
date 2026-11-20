'use client';

import { useParams } from 'next/navigation';
import { useRoomSocket } from '@/hooks/useSocket';
import { useLyricsSync } from '@/hooks/useLyricsSync';

export default function StageViewPage() {
  const params = useParams();
  const roomCode = (params.code as string) || '';

  const { room, lastSync, reactions } = useRoomSocket(roomCode, false);
  const currentTrack = room?.queue.find((t) => t.id === room.currentTrackId) || room?.queue[0];
  const nextTrack = room?.queue.find((t) => t.id !== currentTrack?.id);

  const { lines, activeLineIndex } = useLyricsSync(
    currentTrack?.lyricsBody,
    lastSync,
    room?.lyricsOffsetMs || 0
  );

  return (
    <div className="w-screen h-screen bg-black text-white flex flex-col justify-between overflow-hidden relative font-sans select-none p-8 sm:p-12">
      {/* Top Header */}
      <header className="flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <span className="font-display font-extrabold text-2xl tracking-tighter">interlude</span>
          <span className="font-mono text-xs px-2.5 py-1 rounded bg-surface-800 border border-surface-700 text-muted-light font-bold">
            {roomCode}
          </span>
        </div>

        {nextTrack && (
          <div className="text-xs font-mono text-muted flex items-center gap-2">
            <span>PROSSIMO:</span>
            <strong className="text-white">{nextTrack.title}</strong>
            <span>({nextTrack.addedBy.nickname})</span>
          </div>
        )}
      </header>

      {/* Main Lyrics */}
      <main className="flex-1 flex flex-col items-center justify-center text-center max-w-4xl mx-auto w-full z-10">
        {currentTrack ? (
          <div className="flex flex-col items-center gap-8 w-full">
            {/* Song Info */}
            <div className="flex flex-col items-center">
              <h1 className="font-display font-extrabold text-3xl sm:text-5xl tracking-tight mb-2">
                {currentTrack.title}
              </h1>
              <p className="text-muted-light text-base sm:text-lg">
                {currentTrack.artist} — Canta <strong className="text-white">{currentTrack.addedBy.nickname}</strong>
              </p>
            </div>

            {/* Kinetic Lyrics Display */}
            {lines.length > 0 ? (
              <div className="flex flex-col gap-6 py-8 w-full items-center justify-center">
                {/* Previous Line */}
                {activeLineIndex > 0 && lines[activeLineIndex - 1] && (
                  <p className="text-xl sm:text-2xl text-muted-dark transition-all duration-300">
                    {lines[activeLineIndex - 1].text}
                  </p>
                )}

                {/* Active Line */}
                {lines[activeLineIndex] && (
                  <p className="font-display font-bold text-4xl sm:text-6xl text-white transition-all duration-200">
                    {lines[activeLineIndex].text}
                  </p>
                )}

                {/* Upcoming Line */}
                {lines[activeLineIndex + 1] && (
                  <p className="text-xl sm:text-2xl text-muted transition-all duration-300">
                    {lines[activeLineIndex + 1].text}
                  </p>
                )}
              </div>
            ) : (
              <div className="py-12 text-center text-muted">
                <p className="text-lg">Testo sincronizzato non disponibile</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-16 text-muted">
            <h2 className="font-display font-bold text-3xl text-white mb-3">
              In attesa del prossimo brano
            </h2>
            <p className="text-sm font-mono">
              Entra con il codice <strong className="text-white">{roomCode}</strong> per aggiungere canzoni
            </p>
          </div>
        )}
      </main>

      {/* Live Reactions Floating Stream */}
      <div className="absolute bottom-12 right-12 z-20 pointer-events-none flex flex-col-reverse items-center gap-3">
        {reactions.slice(-6).map((r) => (
          <div key={r.id} className="text-3xl animate-bounce">
            {r.emoji}
          </div>
        ))}
      </div>

      {/* Minimal Footer */}
      <footer className="text-xs font-mono text-muted-dark z-10">
        interlude stage
      </footer>
    </div>
  );
}
