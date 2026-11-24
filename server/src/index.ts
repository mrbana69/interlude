import Fastify from 'fastify';
import cors from '@fastify/cors';
import { setupSocketIO } from './socket.js';
import { getRoom, getOrCreateRoom } from './roomManager.js';
import { searchYouTubeMusic, getAudioStreamFromYTMusic } from './youtubeMusic.js';

const fastify = Fastify({ logger: false });

fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

// Health check (both with and without /api prefix)
const healthHandler = async () => ({
  status: 'ok',
  service: 'interlude-server',
  source: 'YouTube Music',
  timestamp: Date.now()
});
fastify.get('/health', healthHandler);
fastify.get('/api/health', healthHandler);

// Room details
const getRoomHandler = async (request: any, reply: any) => {
  const { code } = request.params as { code: string };
  const room = getRoom(code);
  if (!room) {
    return reply.status(404).send({ error: 'Room not found' });
  }
  return room;
};
fastify.get('/rooms/:code', getRoomHandler);
fastify.get('/api/rooms/:code', getRoomHandler);

// Create new room
const createRoomHandler = async (request: any) => {
  const body = (request.body as { code?: string }) || {};
  const code = body.code || `PARTY-${Math.floor(10 + Math.random() * 90)}`;
  const room = getOrCreateRoom(code);
  return room;
};
fastify.post('/rooms', createRoomHandler);
fastify.post('/api/rooms', createRoomHandler);

// YouTube Music Search
const searchHandler = async (request: any) => {
  try {
    const { q } = request.query as { q?: string };
    if (!q || q.trim().length === 0) return [];
    const results = await searchYouTubeMusic(q.trim());
    return results;
  } catch (err: any) {
    console.error('[API Search Error]:', err);
    return [];
  }
};
fastify.get('/search', searchHandler);
fastify.get('/api/search', searchHandler);

// Proxy copertine immagini per evitare blocchi CORS e referer su mobile Safari & Chrome
const coverProxyHandler = async (request: any, reply: any) => {
  const { url } = request.query as { url?: string };
  if (!url) return reply.status(400).send({ error: 'Parametro url mancante' });

  try {
    const upstreamRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!upstreamRes.ok) {
      return reply.status(upstreamRes.status).send({ error: 'Errore download immagine' });
    }

    const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await upstreamRes.arrayBuffer());

    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'public, max-age=604800, immutable');
    return reply.send(buffer);
  } catch (err: any) {
    return reply.status(502).send({ error: 'Impossibile scaricare immagine da upstream' });
  }
};
fastify.get('/cover-proxy', coverProxyHandler);
fastify.get('/api/cover-proxy', coverProxyHandler);

// Proxy audio streaming diretto da YouTube Music
const streamHandler = async (request: any, reply: any) => {
  const { videoId } = request.params as { videoId: string };
  try {
    const { stream } = await getAudioStreamFromYTMusic(videoId);

    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Content-Type', 'audio/webm');
    reply.header('Cache-Control', 'public, max-age=3600');

    return reply.send(stream);
  } catch (err: any) {
    console.error(`[Stream Error] Impossibile recuperare audio per ${videoId}:`, err?.message);
    return reply.status(502).send({ error: 'Impossibile effettuare lo streaming della traccia' });
  }
};
fastify.get('/stream/:videoId', streamHandler);
fastify.get('/api/stream/:videoId', streamHandler);

const PORT = Number(process.env.PORT) || 2007;

let isReady = false;
let initPromise: Promise<void> | null = null;
async function initServer() {
  if (isReady) return;
  if (!initPromise) {
    initPromise = (async () => {
      await fastify.ready();
      setupSocketIO(fastify.server);
      isReady = true;
    })();
  }
  return initPromise;
}

// Serverless handler for Vercel Functions
export default async function handler(req: any, res: any) {
  try {
    await initServer();
    return new Promise<void>((resolve, reject) => {
      res.on('finish', resolve);
      res.on('close', resolve);
      res.on('error', reject);
      fastify.server.emit('request', req, res);
    });
  } catch (err: any) {
    console.error('[Handler Error]:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Server initialization error', message: err?.message }));
    }
  }
}

// Attach Fastify instance and HTTP server to handler for maximum compatibility
Object.assign(handler, fastify);
(handler as any).server = fastify.server;
(handler as any).fastify = fastify;

// Local development server listener
const isDirectRun = !process.env.VERCEL && Boolean(
  process.argv[1] && (
    process.argv[1].endsWith('index.js') ||
    process.argv[1].endsWith('index.ts') ||
    process.argv[1].endsWith('tsx')
  )
);

if (isDirectRun) {
  initServer().then(() => {
    fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
      if (err) {
        console.error('[Interlude Server] Listen error:', err);
        process.exit(1);
      }
      console.log(`[Interlude Server] Running on http://0.0.0.0:${PORT} (Powered by YouTube Music)`);
    });
  }).catch((err) => {
    console.error('[Interlude Server] Init error:', err);
  });
}
