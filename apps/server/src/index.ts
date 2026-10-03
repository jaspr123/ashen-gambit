// Ashen Gambit server entry point.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { config } from './config.js';
import { createRepository } from './db/index.js';
import { ArenaManager } from './game/ArenaManager.js';
import { BotManager } from './game/BotManager.js';
import { CustomArmyManager } from './game/CustomArmyManager.js';
import { DerbyManager } from './game/DerbyManager.js';
import { MusicManager } from './game/MusicManager.js';
import { PokerManager } from './game/PokerManager.js';
import { LobbyManager } from './game/LobbyManager.js';
import { MatchManager } from './game/MatchManager.js';
import { MatchmakingManager } from './game/MatchmakingManager.js';
import { ProfileManager } from './game/ProfileManager.js';
import { attachSocketServer, createHub } from './net/socketServer.js';

const repo = await createRepository();
const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy (Traefik) in production: trust its X-Forwarded-For for rate limits.
if (config.production) app.set('trust proxy', 1);
app.use(cors({ origin: config.corsOrigin }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.corsOrigin }, maxHttpBufferSize: 1e6, pingInterval: 10_000, pingTimeout: 8_000 });

const hub = createHub(io);
const profiles = new ProfileManager(repo);
const armies = new CustomArmyManager(repo, profiles);
const matches = new MatchManager(hub, repo, profiles, (id) => armies.get(id));
const mm = new MatchmakingManager(hub, repo, profiles, matches);
const arenas = new ArenaManager(config.kotbArenas, hub, profiles, matches);
const lobby = new LobbyManager(hub, profiles, matches, mm, arenas);
const bots = new BotManager(profiles, lobby, matches, mm, arenas);
mm.publicEligibility = (u) => armies.publicEligibility(u);
arenas.publicEligibility = (u) => armies.publicEligibility(u);
await matches.restore();
const music = new MusicManager(hub);
await music.init();
const poker = new PokerManager(hub, profiles);
lobby.pokerSummary = () => poker.summaries();
poker.onChange.push(() => lobby.changed());
const derby = new DerbyManager(hub, profiles, config.derbyFast ? { timing: { betting: 6000, gates: 1500, results: 3000 }, pricingSims: 24 } : {});
derby.botSource = () => [...bots.bots.values()];
lobby.derbySummary = () => (config.derbyEnabled ? derby.summary() : null);
derby.onChange.push(() => lobby.changed());
if (config.derbyEnabled) derby.start();

attachSocketServer(io, hub, { repo, profiles, matches, mm, arenas, lobby, bots, armies, derby, music, poker });

// ------------------------------------------------------------------ HTTP
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: repo.kind, online: lobby.online.size, matches: matches.matches.size, devTools: config.devTools });
});

// ------------------------------------------------------------------ accounts
const authHits = new Map<string, number[]>();
const authLimited = (ip: string) => {
  const now = Date.now();
  const hits = (authHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  authHits.set(ip, hits);
  return hits.length > 20;
};
const authRoute = (fn: (body: Record<string, unknown>, token: string) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
  if (authLimited(req.ip ?? 'x')) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }
  try {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    res.json({ ok: true, data: await fn(req.body ?? {}, token) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'failed' });
  }
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');
app.post('/api/register', express.json({ limit: '4kb' }), authRoute(async (b) => {
  const { user, token } = await profiles.createAccount(str(b.name), str(b.password));
  return { token, name: user.name };
}));
app.post('/api/login', express.json({ limit: '4kb' }), authRoute(async (b) => {
  const { user, token } = await profiles.login(str(b.name), str(b.password));
  return { token, name: user.name };
}));
app.post('/api/logout', express.json({ limit: '4kb' }), authRoute(async (_b, token) => {
  const u = token ? await profiles.findByToken(token) : undefined;
  if (u) await profiles.logout(u, token);
  return null;
}));

// Admin: upload a track into the shared playlist (raw body; title/artist in headers).
app.post('/api/music', express.raw({ type: '*/*', limit: '31mb' }), async (req, res) => {
  try {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const user = token ? await profiles.findByToken(token) : undefined;
    if (!user) { res.status(401).json({ ok: false, error: 'not_authenticated' }); return; }
    if (!(user.isAdmin || config.devTools)) { res.status(403).json({ ok: false, error: 'forbidden' }); return; }
    if (!Buffer.isBuffer(req.body) || !req.body.length) { res.status(400).json({ ok: false, error: 'empty' }); return; }
    const dec = (h: unknown) => { try { return decodeURIComponent(String(h ?? '')); } catch { return ''; } };
    const track = await music.add(req.body, { title: dec(req.headers['x-title']), artist: dec(req.headers['x-artist']), addedBy: user.name });
    res.json({ ok: true, data: track });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'upload_failed' });
  }
});

app.post('/api/upload', express.raw({ type: 'application/octet-stream', limit: config.maxUploadBytes }), async (req, res) => {
  try {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const user = token ? await profiles.findByToken(token) : undefined;
    if (!user) { res.status(401).json({ ok: false, error: 'not_authenticated' }); return; }
    if (!Buffer.isBuffer(req.body) || !req.body.length) { res.status(400).json({ ok: false, error: 'empty' }); return; }
    const out = await armies.storeUpload(user, req.body);
    res.json({ ok: true, data: out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'upload_failed' });
  }
});

app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', immutable: true, fallthrough: false }));

// Serve the built client in production (single-process deploy).
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api|\/uploads|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
}

server.listen(config.port, () => {
  console.log(`[ashen-gambit] server on :${config.port} — db=${repo.kind} devTools=${config.devTools}`);
});

const shutdown = async () => {
  console.log('[ashen-gambit] shutting down');
  bots.dispose();
  derby.dispose();
  await poker.cashOutAll().catch(() => {});
  io.close();
  await repo.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
