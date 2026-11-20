# Interlude — Party DJ Queue & Live Karaoke Hub

Applicazione web collaborativa in tempo reale per feste, DJ queue e karaoke.

- **Host (PC / Tablet collegato alle casse):** Unico dispositivo che riproduce l'audio (*Host-Authoritative Playback*). Gestisce la coda, il crossfade e la calibrazione della latenza audio.
- **Stage View (`/stage/[roomCode]`):** Schermata 16:9 per TV o proiettore con testi sincronizzati a 60fps e reazioni del pubblico live.
- **Guest Mobile (`/room/[code]`):** Web app per smartphone (zero app da installare) per cercare brani su YouTube Music, aggiungerli in coda con 1 tap, seguire i testi sincronizzati dal telefono e inviare reazioni al volo.

---

## Architettura Monorepo

```text
interlude/
├── web/               # Frontend Next.js 15 (App Router, Tailwind CSS, TypeScript)
├── server/            # Backend Fastify + Socket.io + SQLite nativo (node:sqlite WAL mode)
├── DESIGN.md          # Specifiche di Art Direction e Design System
└── docker-compose.yml # Configurazione Docker per deploy backend su VPS
```

### Meccaniche Core
1. **Motore Audio "Sliding Window" sull'Host (Max 2 Blob in RAM):**
   - **Slot #1 (Now Playing):** in riproduzione audio locale.
   - **Slot #2 (Up Next):** pre-scaricato in background per transizioni istantanee.
   - I brani dal **#3 in poi** restano puri metadati testuali (0 byte scaricati).
   - Dual-Deck Crossfade nativo con Web Audio API (0–12s).
2. **Sync Testi a 60fps & Calibrazione Latenza:**
   - Interpolazione fluida via `requestAnimationFrame` da heartbeat WebSocket.
   - Supporto per offset di latenza audio Bluetooth/HDMI globale della stanza (-2000ms a +2000ms).
3. **Ricerca YouTube Music & Proxy Anti-Blocking:**
   - Ricerca nel catalogo ufficiale YouTube Music con thumbnail ottimizzate per schermi retina.
   - Endpoint proxy immagini (`/api/cover-proxy`) integrato per evitare blocchi referer/CORS su iOS Safari e Chrome Android.
4. **Karaoke & Fallback Intelligente:**
   - Sezione Karaoke con ricerca automatica della base strumentale su YouTube Music e testi su LRCLIB / NetEase.
   - Se la base non è disponibile, avviso con opzione 1-tap per utilizzare la traccia originale.

---

## Avvio in Sviluppo

### Prerequisiti
- **Node.js** v20+ o v22+
- **pnpm** v9+

### 1. Backend Server (porta 2007)
```bash
cd server
pnpm install
pnpm dev # oppure pnpm build && pnpm start
```

### 2. Frontend Web (porta 3000)
```bash
cd web
pnpm install
pnpm dev # oppure pnpm build && pnpm start
```

Apri nel browser:
- **Home:** [http://localhost:3000](http://localhost:3000)
- **Host Console:** [http://localhost:3000/host/PARTY-84](http://localhost:3000/host/PARTY-84)
- **Stage TV 16:9:** [http://localhost:3000/stage/PARTY-84](http://localhost:3000/stage/PARTY-84)
- **Guest Mobile:** [http://localhost:3000/room/PARTY-84](http://localhost:3000/room/PARTY-84)

---

## Deploy

- **Frontend (`/web`):** Deploy nativo su **Vercel** (Next.js App Router).
- **Backend (`/server`):** Deploy in container Docker su qualsiasi VPS (Linux, Docker Compose).
```bash
docker compose up -d --build
```
