'use client';

import { useParams } from 'next/navigation';
import { useRoomSocket } from '@/hooks/useSocket';
import { useLyricsSync } from '@/hooks/useLyricsSync';
import { useState, useEffect, useRef } from 'react';

export default function GuestRoomPage() {
  const params = useParams();
  const roomCode = (params.code as string) || '';

  const {
    room,
    connected,
    lastSync,
    queueError,
    clearError,
    addTrack,
    removeTrack,
    sendReaction,
  } = useRoomSocket(roomCode, false);

  const [activeTab, setActiveTab] = useState<'search' | 'lyrics' | 'queue'>('search');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [wantsInstrumental, setWantsInstrumental] = useState(false);
  const [addedToast, setAddedToast] = useState<string | null>(null);

  const currentTrack = room?.queue.find((t) => t.id === room.currentTrackId) || room?.queue[0];
  const { lines, activeLineIndex } = useLyricsSync(currentTrack?.lyricsBody, lastSync);

  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLParagraphElement>(null);

  // Auto-scroll to active lyric line in lyrics tab
  useEffect(() => {
    if (activeTab === 'lyrics' && activeLineRef.current && lyricsContainerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeLineIndex, activeTab]);

  // Debounced search querying backend via Next.js proxy rewrite
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleAddTrack = (track: any, forceNormal = false) => {
    addTrack(track, wantsInstrumental, forceNormal);
    if (!wantsInstrumental || forceNormal) {
      setAddedToast(`"${track.title}" aggiunto in coda`);
      setQuery('');
      setSearchResults([]);
      setTimeout(() => setAddedToast(null), 3000);
    }
  };

  const handleReaction = (emoji: string) => {
    sendReaction(emoji);
    if (navigator.vibrate) {
      navigator.vibrate(30);
    }
  };

  return (
    <div className="h-[100dvh] bg-black text-white flex flex-col font-sans max-w-md mx-auto border-x border-surface-700/60 overflow-hidden relative select-none">
      {/* Top Header */}
      <header className="h-14 border-b border-surface-700/70 bg-black/95 backdrop-blur-md px-4 flex items-center justify-between flex-shrink-0 z-40">
        <div className="flex items-center gap-3">
          <span className="font-display font-extrabold text-xl tracking-tighter">interlude</span>
          <span className="font-mono text-xs px-2.5 py-0.5 rounded-md bg-surface-800 border border-surface-700 text-muted-light font-bold">
            {roomCode}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-accent-green' : 'bg-accent-red'}`} />
          <span className="text-[11px] font-mono text-muted">{connected ? 'Live' : 'Disconnesso'}</span>
        </div>
      </header>

      {/* Segmented Tab Switcher */}
      <div className="px-4 pt-3 pb-1 flex-shrink-0 bg-black">
        <div className="grid grid-cols-3 p-1 bg-surface-900 border border-surface-700/80 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setActiveTab('search')}
            className={`py-2 rounded-lg transition-all ${
              activeTab === 'search'
                ? 'bg-white text-black shadow-sm font-bold'
                : 'text-muted hover:text-white'
            }`}
          >
            Cerca
          </button>
          <button
            onClick={() => setActiveTab('lyrics')}
            className={`py-2 rounded-lg transition-all relative ${
              activeTab === 'lyrics'
                ? 'bg-white text-black shadow-sm font-bold'
                : 'text-muted hover:text-white'
            }`}
          >
            Testo Live
            {currentTrack && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent-green absolute top-2 right-2 animate-pulse" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('queue')}
            className={`py-2 rounded-lg transition-all ${
              activeTab === 'queue'
                ? 'bg-white text-black shadow-sm font-bold'
                : 'text-muted hover:text-white'
            }`}
          >
            Coda ({room?.queue.length || 0})
          </button>
        </div>
      </div>

      {/* Fallback confirmation modal */}
      {queueError && queueError.canFallbackToNormal && queueError.track && (
        <div className="absolute inset-x-4 top-20 p-4 bg-surface-900 border border-surface-600 rounded-2xl shadow-2xl flex flex-col gap-3 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div>
            <p className="font-semibold text-sm text-white">Base strumentale non trovata</p>
            <p className="text-xs text-muted-light mt-1">
              Vuoi aggiungere "{queueError.track.title}" con la voce originale?
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              onClick={clearError}
              className="text-xs text-muted hover:text-white transition-colors px-2 py-1"
            >
              Annulla
            </button>
            <button
              onClick={() => {
                handleAddTrack(queueError.track, true);
                clearError();
              }}
              className="px-3.5 py-1.5 bg-white text-black text-xs font-semibold rounded-lg hover:bg-neutral-200 transition-colors"
            >
              Usa originale
            </button>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {queueError && !queueError.canFallbackToNormal && (
        <div className="mx-4 mt-2 p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-xs text-red-200 flex items-center justify-between z-50">
          <span>{queueError.message}</span>
          <button onClick={clearError} className="font-bold ml-2 text-white">✕</button>
        </div>
      )}

      {/* Toast Alert */}
      {addedToast && (
        <div className="mx-4 mt-2 p-3 bg-surface-800 border border-surface-600 rounded-xl text-xs text-white flex items-center justify-between z-50 animate-in fade-in duration-200">
          <span>{addedToast}</span>
          <button onClick={() => setAddedToast(null)} className="text-muted ml-2">✕</button>
        </div>
      )}

      {/* Main Scrollable Content Bay */}
      <main className="flex-1 overflow-y-auto px-4 pt-2 pb-24 space-y-4">
        {/* ================= TAB 1: CERCA ================= */}
        {activeTab === 'search' && (
          <div className="space-y-4">
            {/* Search Input Box */}
            <div className="relative">
              <input
                type="text"
                placeholder="Cerca canzone o artista..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full px-4 py-3 pl-11 pr-10 bg-surface-900 border border-surface-700/80 rounded-2xl text-white text-sm placeholder:text-muted focus:outline-none focus:border-white transition-colors"
              />
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[20px] text-muted">
                search
              </span>
              {query && (
                <button
                  onClick={() => {
                    setQuery('');
                    setSearchResults([]);
                  }}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-white p-1 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Karaoke Mode Switch (Refined iOS/Minimalist Toggle) */}
            <div className="p-3 bg-surface-900/60 border border-surface-700/60 rounded-2xl flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-white">Base Karaoke (senza voce)</p>
                <p className="text-[11px] text-muted">Cerca la versione strumentale per cantare</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={wantsInstrumental}
                onClick={() => setWantsInstrumental(!wantsInstrumental)}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out flex-shrink-0 ${
                  wantsInstrumental ? 'bg-white' : 'bg-surface-700'
                }`}
              >
                <div
                  className={`bg-black w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                    wantsInstrumental ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Searching Indicator */}
            {isSearching && (
              <div className="py-8 text-center text-xs font-mono text-muted flex items-center justify-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                <span>Ricerca nel catalogo musicale...</span>
              </div>
            )}

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1 text-[11px] font-mono text-muted">
                  <span>RISULTATI ({searchResults.length})</span>
                  <span>1-TAP QUEUE</span>
                </div>

                <div className="space-y-2">
                  {searchResults.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 bg-surface-900 border border-surface-700/70 rounded-2xl flex items-center justify-between gap-3 hover:border-surface-600 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-surface-800 overflow-hidden flex-shrink-0 relative">
                          {item.coverUrl ? (
                            <img
                              src={item.coverUrl}
                              alt={item.title}
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted text-xs">♫</div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-xs text-white truncate">{item.title}</p>
                          <p className="text-[11px] text-muted truncate mt-0.5">{item.artist}</p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleAddTrack(item)}
                        className="px-3.5 py-1.5 bg-white text-black text-xs font-bold rounded-xl hover:bg-neutral-200 active:scale-95 transition-all flex-shrink-0"
                      >
                        + Accoda
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state hint */}
            {!isSearching && searchResults.length === 0 && !query && (
              <div className="pt-6 text-center space-y-4">
                <div className="p-4 bg-surface-900/40 border border-surface-700/50 rounded-2xl text-left">
                  <p className="text-xs font-semibold text-white mb-1">Come funziona:</p>
                  <p className="text-xs text-muted leading-relaxed">
                    Cerca qualsiasi canzone. Con 1 tap viene aggiunta alla coda delle casse dell'Host in modalità First-Come, First-Served.
                  </p>
                </div>

                {currentTrack && (
                  <div
                    onClick={() => setActiveTab('lyrics')}
                    className="p-3.5 bg-surface-900 border border-surface-700/70 rounded-2xl flex items-center justify-between cursor-pointer hover:border-surface-600 transition-all text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-surface-800 overflow-hidden flex-shrink-0">
                        {currentTrack.coverUrl ? (
                          <img
                            src={currentTrack.coverUrl}
                            alt="Cover"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted text-xs">♫</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] font-mono text-accent-green uppercase font-bold tracking-wider">
                          In Riproduzione
                        </span>
                        <p className="text-xs font-semibold text-white truncate">{currentTrack.title}</p>
                        <p className="text-[11px] text-muted truncate">{currentTrack.artist}</p>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-white/80 pr-1">Vedi testo →</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: TESTO LIVE ================= */}
        {activeTab === 'lyrics' && (
          <div className="space-y-4">
            {currentTrack ? (
              <div className="space-y-4">
                {/* Track Bar Header */}
                <div className="p-4 bg-surface-900 border border-surface-700/70 rounded-2xl flex items-center gap-3.5">
                  <div className="w-14 h-14 rounded-xl bg-surface-800 overflow-hidden flex-shrink-0">
                    {currentTrack.coverUrl ? (
                      <img
                        src={currentTrack.coverUrl}
                        alt="Cover"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted text-xs">♫</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-bold text-base truncate">{currentTrack.title}</h3>
                    <p className="text-xs text-muted truncate mt-0.5">{currentTrack.artist}</p>
                    <p className="text-[11px] font-mono text-muted mt-1">
                      Cantato da: <strong className="text-white">{currentTrack.addedBy.nickname}</strong>
                    </p>
                  </div>
                </div>

                {/* Lyrics Teleprompter */}
                {lines.length > 0 ? (
                  <div
                    ref={lyricsContainerRef}
                    className="p-5 bg-surface-900/60 border border-surface-700/50 rounded-2xl space-y-5 text-center max-h-[55vh] overflow-y-auto"
                  >
                    {lines.map((line, idx) => {
                      const isActive = idx === activeLineIndex;
                      const isPast = idx < activeLineIndex;

                      return (
                        <p
                          key={idx}
                          ref={isActive ? activeLineRef : null}
                          className={`transition-all duration-200 leading-relaxed ${
                            isActive
                              ? 'text-lg sm:text-xl font-display font-bold text-white scale-105'
                              : isPast
                              ? 'text-xs text-muted/40 font-medium'
                              : 'text-xs text-muted font-medium'
                          }`}
                        >
                          {line.text}
                        </p>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-16 text-center text-muted p-6 bg-surface-900/40 rounded-2xl border border-surface-700/40">
                    <span className="material-symbols-outlined text-3xl mb-2 text-muted">lyrics</span>
                    <p className="text-sm font-semibold text-white">Testo sincronizzato non disponibile</p>
                    <p className="text-xs text-muted mt-1">Canta a memoria! La musica sta suonando sulle casse.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-20 text-center text-muted p-6 bg-surface-900/40 rounded-2xl border border-surface-700/40">
                <span className="material-symbols-outlined text-4xl mb-2 text-muted">music_off</span>
                <p className="text-sm font-semibold text-white">Nessun brano in riproduzione</p>
                <p className="text-xs text-muted mt-1">Usa la scheda "Cerca" per scegliere la prima canzone!</p>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 3: CODA ================= */}
        {activeTab === 'queue' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1 text-xs font-mono text-muted">
              <span>CODA ATTUALE ({room?.queue.length || 0})</span>
              <span>FCFS TIMESTAMPS</span>
            </div>

            <div className="space-y-2">
              {room?.queue.map((track, idx) => {
                const isCurrent = track.id === room.currentTrackId;

                return (
                  <div
                    key={track.id}
                    className={`p-3 rounded-2xl border flex items-center justify-between gap-3 transition-colors ${
                      isCurrent
                        ? 'bg-surface-800 border-white/40'
                        : 'bg-surface-900 border-surface-700/70'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-xs text-muted w-4 text-center font-bold">
                        #{idx + 1}
                      </span>
                      <div className="w-10 h-10 rounded-xl bg-surface-800 overflow-hidden flex-shrink-0">
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
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold text-white truncate">{track.title}</p>
                          {track.isKaraoke && (
                            <span className="px-1.5 py-0.2 bg-white/10 text-[9px] font-mono rounded text-muted-light">
                              KARAOKE
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted truncate mt-0.5">
                          {track.artist} • <span className="text-white/80 font-medium">{track.addedBy.nickname}</span>
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => removeTrack(track.id)}
                      className="p-2 text-muted hover:text-white transition-colors flex-shrink-0"
                      title="Rimuovi"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                );
              })}

              {(!room?.queue || room.queue.length === 0) && (
                <div className="py-16 text-center text-muted font-mono text-xs">
                  Coda vuota. Cerca un brano e aggiungilo!
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ================= FIXED BOTTOM REACTION DOCK ================= */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-50 bg-black/95 backdrop-blur-xl border-t border-surface-700/80 px-4 py-2.5 pb-[calc(0.6rem+env(safe-area-inset-bottom,0px))] flex items-center justify-around shadow-2xl">
        {['🔥', '👏', '🎉', '🎤', '❤️'].map((emoji) => (
          <button
            key={emoji}
            onClick={() => handleReaction(emoji)}
            className="w-12 h-12 rounded-full bg-surface-900 border border-surface-700/80 flex items-center justify-center text-xl hover:bg-surface-800 active:scale-90 transition-transform shadow-sm"
            title={`Invia ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
