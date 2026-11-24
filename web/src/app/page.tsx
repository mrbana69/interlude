'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LandingPage() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) return;
    if (nickname.trim()) {
      localStorage.setItem('interlude_nickname', nickname.trim());
    }
    router.push(`/room/${roomCode.toUpperCase().trim()}`);
  };

  const handleCreateRoom = () => {
    setIsCreating(true);
    const code = `ROOM-${Math.floor(10 + Math.random() * 90)}`;
    if (nickname.trim()) {
      localStorage.setItem('interlude_nickname', nickname.trim());
    }
    router.push(`/host/${code}`);
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col justify-between p-6 sm:p-12 font-sans">
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
            Entra
          </button>
        </form>
      </main>

      {/* Minimal Footer */}
      <footer className="text-center sm:text-left text-xs font-mono text-muted-dark">
        interlude
      </footer>
    </div>
  );
}
