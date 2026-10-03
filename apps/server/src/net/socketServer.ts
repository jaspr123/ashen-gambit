// Socket.IO wiring: authentication, schema validation, rate limiting and
// routing of client intents to the managers. Every handler receives an
// already-validated payload and the authenticated user — never raw input.

import type { Server, Socket } from 'socket.io';
import { C2S, type C2SEvent, type C2SPayload, type GameHistoryEntry, type ReplayData, type S2CEvents } from '@ashen/shared';
import { config } from '../config.js';
import type { Repository } from '../db/index.js';
import type { GameRecord, UserRecord } from '../db/repository.js';
import type { ArenaManager } from '../game/ArenaManager.js';
import type { BotManager } from '../game/BotManager.js';
import type { CustomArmyManager } from '../game/CustomArmyManager.js';
import type { DerbyManager } from '../game/DerbyManager.js';
import type { MusicManager } from '../game/MusicManager.js';
import type { PokerManager } from '../game/PokerManager.js';
import crypto from 'node:crypto';
import type { Hub } from '../game/hub.js';
import type { LobbyManager } from '../game/LobbyManager.js';
import type { MatchManager } from '../game/MatchManager.js';
import type { MatchmakingManager } from '../game/MatchmakingManager.js';
import type { ProfileManager } from '../game/ProfileManager.js';
import { bucketsFor } from './rateLimiter.js';

export interface Services {
  repo: Repository;
  profiles: ProfileManager;
  matches: MatchManager;
  mm: MatchmakingManager;
  arenas: ArenaManager;
  lobby: LobbyManager;
  bots: BotManager;
  armies: CustomArmyManager;
  derby: DerbyManager;
  music: MusicManager;
  poker: PokerManager;
}

type AckFn = (res: { ok: boolean; data?: unknown; error?: string }) => void;
type Handler<E extends C2SEvent> = (user: UserRecord, payload: C2SPayload<E>, socket: Socket) => Promise<unknown> | unknown;

export function createHub(io: Server): Hub & { sockets: Map<string, number> } {
  const sockets = new Map<string, number>();
  return {
    sockets,
    emitUser: (userId, event, ...args) => { io.to(`user:${userId}`).emit(event, ...(args as unknown as [])); },
    emitRoom: (room, event, ...args) => { io.to(room).emit(event, ...(args as unknown as [])); },
    emitAll: (event, ...args) => { io.to('authed').emit(event, ...(args as unknown as [])); },
    joinRoom: (userId, room) => { io.in(`user:${userId}`).socketsJoin(room); },
    leaveRoom: (userId, room) => { io.in(`user:${userId}`).socketsLeave(room); },
    isOnline: (userId) => (sockets.get(userId) ?? 0) > 0,
  };
}

export function attachSocketServer(io: Server, hub: ReturnType<typeof createHub>, s: Services) {
  const offlineTimers = new Map<string, NodeJS.Timeout>();

  io.on('connection', (socket) => {
    const buckets = bucketsFor();
    let user: UserRecord | null = null;
    const authTimeout = setTimeout(() => { if (!user) socket.disconnect(true); }, 15_000);

    function on<E extends C2SEvent>(event: E, handler: Handler<E>, opts: { auth?: boolean; bucket?: keyof typeof buckets; dev?: boolean } = {}) {
      socket.on(event as string, async (raw: unknown, ack?: AckFn) => {
        const reply: AckFn = typeof ack === 'function' ? ack : () => {};
        if (!buckets.general.take() || (opts.bucket && !buckets[opts.bucket].take())) return reply({ ok: false, error: 'rate_limited' });
        if (opts.auth !== false && !user) return reply({ ok: false, error: 'not_authenticated' });
        if (opts.dev && !(config.devTools || user?.isAdmin)) return reply({ ok: false, error: 'forbidden' });
        const parsed = C2S[event].safeParse(raw ?? {});
        if (!parsed.success) return reply({ ok: false, error: 'invalid_payload' });
        try {
          const data = await handler(user!, parsed.data as C2SPayload<E>, socket);
          reply({ ok: true, data });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!/^[a-z_:\w.-]+$/i.test(msg)) console.error(`[${event}]`, e);
          reply({ ok: false, error: msg.length > 120 ? 'server_error' : msg });
        }
      });
    }

    // ------------------------------------------------------------ session
    on('auth', async (_u, p) => {
      if (user) return { profile: s.profiles.self(user) };
      const res = await s.profiles.authenticate(p.token, p.name);
      user = res.user;
      clearTimeout(authTimeout);
      socket.join(`user:${user.id}`);
      socket.join('authed');
      hub.sockets.set(user.id, (hub.sockets.get(user.id) ?? 0) + 1);
      const t = offlineTimers.get(user.id);
      if (t) { clearTimeout(t); offlineTimers.delete(user.id); }
      s.lobby.enter(user.id);
      s.matches.setConnected(user.id, true);
      socket.emit('lobby:snapshot', s.lobby.snapshot());
      const active = s.matches.activeMatchOf(user.id);
      if (active) socket.emit('match:state', active.stateFor(user.id));
      return { token: res.token, profile: s.profiles.self(user) };
    }, { auth: false });

    on('profile:update', async (u, p) => {
      if (p.name) await s.profiles.rename(u, p.name);
      if (p.avatar) { u.avatar = p.avatar; await s.profiles.save(u); }
      s.lobby.changed();
      return s.profiles.self(u);
    });
    const requireAdmin = (u: UserRecord) => { if (!(u.isAdmin || config.devTools)) throw new Error('forbidden'); };
    on('account:claim-admin', async (u, p) => {
      const want = Buffer.from(config.adminCode), got = Buffer.from(p.code);
      if (!config.adminCode || want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw new Error('bad_admin_code');
      u.isAdmin = true;
      await s.profiles.save(u);
      return s.profiles.self(u);
    }, { bucket: 'chat' });
    on('poker:watch', (u, p) => s.poker.watch(u, p.tableId, p.on));
    on('poker:join', (u, p) => s.poker.join(u, p.tableId, p.seat), { bucket: 'game' });
    on('poker:leave', (u, p) => s.poker.leave(u, p.tableId), { bucket: 'game' });
    on('poker:act', (u, p) => s.poker.act(u, p.tableId, p.action, p.amount), { bucket: 'game' });
    on('music:list', () => s.music.list());
    on('music:remove', async (u, p) => { requireAdmin(u); await s.music.remove(p.id); });
    on('music:move', async (u, p) => { requireAdmin(u); await s.music.move(p.id, p.delta); });
    on('account:password', async (u, p) => {
      await s.profiles.setPassword(u, p.password, p.current);
      return s.profiles.self(u);
    }, { bucket: 'chat' });
    on('loadout:set', async (u, p) => {
      await s.profiles.setLoadout(u, p, (id) => s.armies.owns(u.id, id));
      s.lobby.changed();
      return s.profiles.self(u);
    });
    on('profile:get', async (_u, p) => {
      const t = await s.profiles.get(p.userId);
      if (!t) throw new Error('no_player');
      return { id: t.id, name: t.name, avatar: t.avatar, rating: t.rating, stats: t.stats, achievements: t.achievements, bot: t.bot };
    });
    on('leaderboard:get', async () => (await s.repo.topUsers(25)).map((u) => ({ id: u.id, name: u.name, avatar: u.avatar, rating: u.rating, wins: u.stats.wins, losses: u.stats.losses, draws: u.stats.draws })));

    // ------------------------------------------------------------ matchmaking
    on('queue:join', async (u, p) => {
      if (p.kind === 'kotb' || u.loadout.mode === 'kotb') return s.arenas.join(u, p.arenaId);
      return s.mm.join(u, { mode: p.mode, withUser: p.withUser });
    });
    on('queue:leave', (u) => { s.mm.leave(u.id); s.arenas.leave(u.id); });
    on('challenge:send', (u, p) => s.mm.challenge(u, p.targetId));
    on('challenge:respond', (u, p) => s.mm.respond(u, p.challengeId, p.accept));
    on('private:create', (u) => ({ code: s.mm.createPrivate(u) }));
    on('private:join', (u, p) => s.mm.joinPrivate(u, p.code));

    // ------------------------------------------------------------ matches
    const matchFor = (u: UserRecord, id: string) => {
      const m = s.matches.matches.get(id);
      if (!m) throw new Error('no_match');
      if (!m.colorOf(u.id)) throw new Error('not_a_player');
      return m;
    };
    const unwrap = <T,>(r: { ok: true; data?: T } | { ok: false; error: string }) => { if (!r.ok) throw new Error(r.error); return r.data; };
    on('match:spectate', (u, p) => { s.matches.spectate(u.id, p.matchId); });
    on('match:unspectate', (u, p) => { s.matches.matches.get(p.matchId)?.removeSpectator(u.id); });
    on('match:sync', (u, p) => {
      const m = s.matches.matches.get(p.matchId);
      if (!m) throw new Error('no_match');
      return m.stateFor(m.colorOf(u.id) ? u.id : null);
    });
    on('match:move', (u, p) => unwrap(matchFor(u, p.matchId).move(u.id, p as never)), { bucket: 'game' });
    on('match:ability', (u, p) => unwrap(matchFor(u, p.matchId).ability(u.id, p as never)), { bucket: 'game' });
    on('match:pick', (u, p) => unwrap(matchFor(u, p.matchId).pick(u.id, p as never)), { bucket: 'game' });
    on('match:resign', (u, p) => unwrap(matchFor(u, p.matchId).resign(u.id)));
    on('match:draw', (u, p) => unwrap(matchFor(u, p.matchId).draw(u.id, p.action)), { bucket: 'game' });
    on('match:rematch', (u, p) => unwrap(matchFor(u, p.matchId).rematch(u.id)));
    on('match:chat', (u, p) => {
      const m = s.matches.matches.get(p.matchId);
      if (!m || (!m.colorOf(u.id) && !m.spectators.has(u.id))) throw new Error('not_in_match');
      const msg = { matchId: m.id, from: u.id, name: u.name, text: p.text.replace(/[<>]/g, ''), at: Date.now() };
      for (const c of ['w', 'b'] as const) hub.emitUser(m.players[c].id, 'match:chat', msg);
      hub.emitRoom(`spect:${m.id}`, 'match:chat', msg);
    }, { bucket: 'chat' });
    on('match:emote', (u, p) => {
      const m = s.matches.matches.get(p.matchId);
      if (!m) throw new Error('no_match');
      const color = m.colorOf(u.id) ?? (m.spectators.has(u.id) ? 'spectator' : null);
      if (!color) throw new Error('not_in_match');
      const msg = { matchId: m.id, from: u.name, color, emote: p.emote } as Parameters<S2CEvents['match:emote']>[0];
      for (const c of ['w', 'b'] as const) hub.emitUser(m.players[c].id, 'match:emote', msg);
      hub.emitRoom(`spect:${m.id}`, 'match:emote', msg);
    }, { bucket: 'chat' });

    // ------------------------------------------------------------ history / replays
    const entry = (g: GameRecord): GameHistoryEntry => ({
      id: g.id, mode: g.mode, result: g.result, plies: g.moves.length, endedAt: g.endedAt,
      white: { id: g.white.id, name: g.white.name, faction: g.white.faction }, black: { id: g.black.id, name: g.black.name, faction: g.black.faction },
    });
    on('history:list', async (u, p) => {
      const games = p.userId ? await s.repo.gamesForUser(p.userId, p.limit ?? 20) : await s.repo.gamesForUser(u.id, p.limit ?? 20);
      return games.map(entry);
    });
    on('replay:get', async (_u, p): Promise<ReplayData> => {
      const g = await s.repo.getGame(p.gameId);
      if (!g) throw new Error('no_game');
      return { ...entry(g), moves: g.moves, finishers: { w: g.white.finishers, b: g.black.finishers }, startFen: g.startFen, armies: g.armies };
    });

    // ------------------------------------------------------------ custom armies
    on('army:list', (u) => s.armies.list(u.id));
    on('army:save', (u, p) => s.armies.save(u, p.army));
    on('army:delete', (u, p) => s.armies.remove(u, p.armyId));

    // ------------------------------------------------------------ wasteland derby
    on('derby:watch', (u, p) => s.derby.watch(u, p.on));
    on('derby:bet', (u, p) => s.derby.bet(u, p), { bucket: 'game' });
    on('derby:cancel', (u, p) => s.derby.cancel(u, p), { bucket: 'game' });
    on('derby:upgrade', (u, p) => s.derby.upgrade(u, p), { bucket: 'game' });
    on('derby:chat', (u, p) => s.derby.chat(u, p.text), { bucket: 'chat' });

    // ------------------------------------------------------------ misc / dev
    on('ping', (_u, p) => { socket.emit('pong', { t: p.t, serverNow: Date.now() }); }, { auth: false });
    on('dev:bots', async (_u, p) => {
      if (p.action === 'add') return s.bots.add(p.count ?? 4).map((b) => b.name);
      if (p.action === 'clear') { s.bots.clear(); return; }
      const m = await s.bots.exhibition();
      return { matchId: m.id };
    }, { dev: true });

    socket.on('disconnect', () => {
      clearTimeout(authTimeout);
      if (!user) return;
      const id = user.id;
      const n = (hub.sockets.get(id) ?? 1) - 1;
      if (n > 0) { hub.sockets.set(id, n); return; }
      hub.sockets.delete(id);
      s.derby.watch(user, false);
      s.matches.setConnected(id, false);
      s.lobby.exit(id);
      // Keep queue spots briefly so a page refresh does not lose your place.
      offlineTimers.set(id, setTimeout(() => {
        offlineTimers.delete(id);
        if (hub.isOnline(id)) return;
        s.mm.leave(id);
        s.arenas.leave(id, true);
        void s.poker.dropUser(id);
      }, 15_000));
    });
  });
}
