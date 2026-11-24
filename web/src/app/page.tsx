'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getDeviceType, DeviceType } from '@/lib/deviceDetection';

export default function LandingPage() {
  const router = useRouter();
  const roomInputRef = useRef<HTMLInputElement>(null);
  const [roomCode, setRoomCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deviceModal, setDeviceModal] = useState<DeviceType | null>(null);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) return;
    if (nickname.trim()) {
      localStorage.setItem('interlude_nickname', nickname.trim());
    }
    router.push(`/room/${roomCode.toUpperCase().trim()}`);
  };

  const proceedCreateRoom = () => {
    setIsCreating(true);
    setDeviceModal(null);
    const code = `ROOM-${Math.floor(10 + Math.random() * 90)}`;
    if (nickname.trim()) {
      localStorage.setItem('interlude_nickname', nickname.trim());
    }
    router.push(`/host/${code}`);
  };

  const handleCreateRoom = () => {
    const dev = getDeviceType();
    if (dev === 'mobile') {
      setDeviceModal('mobile');
      return;
    }
    if (dev === 'tablet') {
      setDeviceModal('tablet');
      return;
    }
    proceedCreateRoom();
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col justify-between p-6 sm:p-12 font-sans select-none">
      {/* Minimal Header */}
      <header className="flex items-center justify-between">
        <h1 className="font-display font-extrabold text-2xl tracking-tighter">
          interlude
        </h1>
        <button
          onClick={handleCreateRoom}
          disabled={isCreating}
          className="text-xs font-mono text-muted-light hover:text-white transition-colors"
        >
          {isCreating ? 'Creazione...' : 'Crea stanza Host →'}
        </button>
      </header>

      {/* Minimal Center Form */}
      <main className="my-auto max-w-sm w-full mx-auto py-12">
        <form onSubmit={handleJoin} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono text-muted uppercase tracking-wider">
              Codice Stanza
            </label>
            <input
              ref={roomInputRef}
              type="text"
              placeholder="es. PARTY-84"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              className="w-full px-4 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white font-mono text-lg uppercase tracking-wider focus:outline-none focus:border-white transition-colors placeholder:text-muted-dark"
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono text-muted uppercase tracking-wider">
              Il tuo nome
            </label>
            <input
              type="text"
              placeholder="es. Marco"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full px-4 py-3 bg-surface-900 border border-surface-700 rounded-lg text-white text-base focus:outline-none focus:border-white transition-colors placeholder:text-muted-dark"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full py-3.5 mt-2 bg-white text-black font-semibold text-sm rounded-lg hover:bg-neutral-200 transition-colors"
          >
            Entra come Ospite
          </button>
        </form>
      </main>

      {/* Minimal Footer */}
      <footer className="text-center sm:text-left text-xs font-mono text-muted-dark">
        interlude · festa collaborativa
      </footer>

      {/* ================= MODALE CONTROLLO DISPOSITIVO ================= */}
      {deviceModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-surface-900 border border-surface-700/90 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col gap-5">
            {deviceModal === 'mobile' ? (
              <>
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center text-2xl">
                  📺
                </div>

                <div>
                  <h3 className="font-display font-bold text-xl text-white">
                    Avvia la stanza da PC o Smart TV
                  </h3>
                  <p className="text-muted-light text-sm mt-2 leading-relaxed">
                    La console <strong>Host</strong> gestisce la musica e lo schermo della festa collegati alle casse.
                  </p>
                  <p className="text-muted text-xs mt-2.5 leading-relaxed bg-surface-800/80 p-3 rounded-xl border border-surface-700/60">
                    💡 <strong>Perché non su smartphone?</strong> I telefoni bloccano la riproduzione continua quando lo schermo va in standby. Usa un <strong>PC</strong> o la <strong>Smart TV</strong> per la console, e usa il tuo telefono per unirti alla stanza come ospite per aggiungere le canzoni!
                  </p>
                  <p className="text-[11px] font-mono text-muted-dark mt-2">
                    (Rilevato smartphone. La restrizione si applica anche se attivi la modalità desktop).
                  </p>
                </div>

                <div className="flex flex-col gap-2 pt-1">
                  <button
                    onClick={() => {
                      setDeviceModal(null);
                      setTimeout(() => roomInputRef.current?.focus(), 150);
                    }}
                    className="w-full py-3 rounded-xl bg-white text-black font-semibold text-sm hover:bg-neutral-200 transition-colors"
                  >
                    Ho capito, entra come Ospite
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 flex items-center justify-center text-2xl">
                  ⚠️
                </div>

                <div>
                  <h3 className="font-display font-bold text-xl text-white">
                    Tablet rilevato — Non consigliato
                  </h3>
                  <p className="text-muted-light text-sm mt-2 leading-relaxed">
                    La console audio Host è pensata principalmente per <strong>PC, laptop o Smart TV</strong> collegati alle casse.
                  </p>
                  <p className="text-muted text-xs mt-2.5 leading-relaxed bg-surface-800/80 p-3 rounded-xl border border-surface-700/60">
                    Sui tablet l&apos;audio potrebbe sospendersi se lo schermo si spegne o se il browser va in background. Se puoi, aprila da PC o TV collegato alla corrente.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                  <button
                    onClick={proceedCreateRoom}
                    className="flex-1 py-3 rounded-xl bg-white text-black font-semibold text-sm hover:bg-neutral-200 transition-colors"
                  >
                    Procedi comunque
                  </button>
                  <button
                    onClick={() => setDeviceModal(null)}
                    className="flex-1 py-3 rounded-xl bg-surface-800 border border-surface-700 text-muted-light hover:text-white font-medium text-sm transition-colors"
                  >
                    Annulla
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
