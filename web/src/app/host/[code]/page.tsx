'use client';

import { useParams } from 'next/navigation';
import { useRoomSocket } from '@/hooks/useSocket';
import { useHostAudioDeck } from '@/hooks/useHostAudioDeck';
import { useState } from 'react';

export default function HostConsolePage() {
  const params = useParams();
  const roomCode = (params.code as string) || '';
  const [crossfade, setCrossfade] = useState(4);
  const [copied, setCopied] = useState(false);

  const {
    room,
    connected,
    removeTrack,
    sendPlaybackSync,
  } = useRoomSocket(roomCode, true);

  const currentTrack = room?.queue.find((t) => t.id === room.currentTrackId) || room?.queue[0];

  const {
    isPlaying,
    currentTime,
    duration,
    play,
    pause,
    skip,
  } = useHostAudioDeck(
    room?.queue || [],
    room?.currentTrackId || null,
    (newTrackId) => {
      sendPlaybackSync('playing', newTrackId, 0);
    },
    (status, trackId, pos) => {
      sendPlaybackSync(status, trackId, pos);
    }
  );

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const copyGuestLink = () => {
    const url = `${window.location.origin}/room/${roomCode}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-sans select-none">
      {/* Clean Header */}
      <header className="h-16 border-b border-surface-700 px-6 flex items-center justify-between sticky top-0 z-40 bg-black/90 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <span className="font-display font-extrabold text-xl tracking-tight">interlude</span>
          <span className="font-mono text-xs px-2.5 py-1 rounded bg-surface-800 border border-surface-700 text-white font-bold uppercase tracking-wider">
            {roomCode}
          </span>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-accent-green' : 'bg-accent-red'}`} />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={copyGuestLink}
            className="px-3.5 py-1.5 rounded-lg border border-surface-700 text-xs font-mono text-muted-light hover:text-white hover:border-surface-600 transition-colors"
          >
            {copied ? 'Link Copiato' : 'Copia link ospiti'}
          </button>
          <a
            href={`/stage/${roomCode}`}
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-1.5 rounded-lg bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors"
          >
            Apri Stage TV
          </a>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 p-6 max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start my-auto">
        {/* Left Column: Now Playing */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="border border-surface-700 bg-surface-900 rounded-2xl p-6 sm:p-8 flex flex-col gap-6">
            {currentTrack ? (
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
                <div className="w-32 h-32 rounded-xl bg-surface-800 border border-surface-700 overflow-hidden flex-shrink-0">
                  {currentTrack.coverUrl ? (
                    <img
                      src={currentTrack.coverUrl}
                      alt={currentTrack.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted">
                      <span className="material-symbols-outlined text-4xl">album</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                    <h2 className="font-display font-bold text-2xl truncate">
                      {currentTrack.title}
                    </h2>
                    {currentTrack.isKaraoke && (
                      <span className="px-2 py-0.5 bg-white/10 text-white text-[10px] font-mono rounded">
                        KARAOKE
                      </span>
                    )}
                  </div>
                  <p className="text-muted-light text-base truncate mb-3">
                    {currentTrack.artist}
                  </p>
                  <p className="text-xs font-mono text-muted">
                    Richiesta da <strong className="text-white">{currentTrack.addedBy.nickname}</strong>
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-muted font-mono text-sm">
                Nessun brano in riproduzione
              </div>
            )}

            {/* Timeline */}
            <div className="flex flex-col gap-2 pt-2">
              <div className="w-full bg-surface-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-white h-full transition-all duration-300"
                  style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                />
              </div>
              <div className="flex items-center justify-between font-mono text-xs text-muted">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Transport Controls */}
            <div className="flex items-center justify-center gap-6 pt-2">
              <button
                onClick={isPlaying ? pause : play}
                className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center hover:bg-neutral-200 transition-colors"
                title={isPlaying ? 'Pausa' : 'Play'}
              >
                <span className="material-symbols-outlined text-[28px]">
                  {isPlaying ? 'pause' : 'play_arrow'}
                </span>
              </button>

              <button
                onClick={skip}
                className="w-12 h-12 rounded-full border border-surface-700 bg-surface-800 text-white hover:border-surface-600 flex items-center justify-center transition-colors"
                title="Salta"
              >
                <span className="material-symbols-outlined text-[22px]">skip_next</span>
              </button>
            </div>

            {/* Crossfade */}
            <div className="border-t border-surface-700 pt-4 flex items-center justify-between text-xs font-mono text-muted">
              <span>Crossfade</span>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="12"
                  value={crossfade}
                  onChange={(e) => setCrossfade(Number(e.target.value))}
                  className="w-28 accent-white cursor-pointer"
                />
                <span className="text-white w-6 text-right">{crossfade}s</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Queue */}
        <div className="lg:col-span-5 flex flex-col">
          <div className="border border-surface-700 bg-surface-900 rounded-2xl p-6 flex flex-col min-h-[460px]">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-surface-700">
              <h3 className="font-semibold text-sm">
                Coda ({room?.queue.length || 0})
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-2 max-h-[420px] pr-1">
              {room?.queue.map((track, idx) => (
                <div
                  key={track.id}
                  className={`p-3 rounded-xl border flex items-center gap-3 transition-colors ${
                    track.id === room.currentTrackId
                      ? 'border-white/40 bg-surface-800'
                      : 'border-surface-700 bg-black/60'
                  }`}
                >
                  <span className="font-mono text-xs text-muted w-4 text-center">
                    {idx + 1}
                  </span>

                  <div className="w-10 h-10 rounded-lg bg-surface-800 overflow-hidden flex-shrink-0">
                    {track.coverUrl ? (
                      <img
                        src={track.coverUrl}
                        alt="Cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted text-xs">♫</div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs truncate">{track.title}</p>
                    <p className="text-[11px] text-muted truncate mt-0.5">
                      {track.artist} • {track.addedBy.nickname}
                    </p>
                  </div>

                  <button
                    onClick={() => removeTrack(track.id)}
                    className="p-1 text-muted hover:text-white transition-colors"
                    title="Rimuovi"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              ))}

              {(!room?.queue || room.queue.length === 0) && (
                <div className="flex-1 flex items-center justify-center text-center text-muted font-mono text-xs py-16">
                  Coda vuota
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
