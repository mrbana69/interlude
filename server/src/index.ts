import Fastify from 'fastify';
import cors from '@fastify/cors';
import { setupSocketIO } from './socket.js';
import { getRoom, getOrCreateRoom } from './roomManager.js';
import { searchYouTubeMusic, getAudioStreamFromYTMusic } from './youtubeMusic.js';

const fastify = Fastify({ logger: false });

await fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', service: 'interlude-server', source: 'YouTube Music', timestamp: Date.now() };
});
fastify.get('/api/health', async () => {
  return { status: 'ok', service: 'interlude-server', source: 'YouTube Music', timestamp: Date.now() };
});

// Get room details
fastify.get('/api/rooms/:code', async (request, reply) => {
  const { code } = request.params as { code: string };
  const room = getRoom(code);
  if (!room) {
    return reply.status(404).send({ error: 'Room not found' });
  }
  return room;
});

// Create new room
fastify.post('/api/rooms', async (request, reply) => {
  const body = (request.body as { code?: string }) || {};
  const code = body.code || `PARTY-${Math.floor(10 + Math.random() * 90)}`;
  const room = getOrCreateRoom(code);
  return room;
});

// Ricerca brani RIGOROSAMENTE su YouTube Music
fastify.get('/api/search', async (request, reply) => {
  const { q } = request.query as { q?: string };
  if (!q || q.trim().length === 0) return [];

  const results = await searchYouTubeMusic(q.trim());
  return results;
});

// Proxy copertine immagini per evitare blocchi CORS e referer su mobile Safari & Chrome
fastify.get('/api/cover-proxy', async (request, reply) => {
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
});

// Proxy audio streaming diretto da YouTube Music
fastify.get('/api/stream/:videoId', async (request, reply) => {
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
});

const PORT = Number(process.env.PORT) || 2007;

// Initialize plugins and attach socket.io to the underlying HTTP server
await fastify.ready();
setupSocketIO(fastify.server);

if (!process.env.VERCEL) {
  fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) {
      console.error('[Interlude Server] Listen error:', err);
      process.exit(1);
    }
    console.log(`[Interlude Server] Running on http://0.0.0.0:${PORT} (Powered by YouTube Music)`);
  });
}

export default fastify;
