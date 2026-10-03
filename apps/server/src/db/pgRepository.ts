// PostgreSQL implementation of the Repository, writing the normalized schema in schema.sql.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ABILITIES, ACHIEVEMENTS, DEATH_TYPES, DERBY_START_CREDITS, type CustomArmy, type CustomPiece, type PieceClass } from '@ashen/shared';
import type { ActiveGameRecord, GameRecord, QueueRecord, Repository, UserRecord } from './repository.js';

type StoredArmy = CustomArmy & { ownerId: string; valid: boolean };
const here = path.dirname(fileURLToPath(import.meta.url));

export class PgRepository implements Repository {
  readonly kind = 'postgres' as const;
  private pool: pg.Pool;

  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url, max: 10 }); }

  async init() {
    const sql = await fs.readFile(path.join(here, 'schema.sql'), 'utf8');
    await this.pool.query(sql);
    // Mirror content registries for admin/analytics joins.
    for (const a of ABILITIES) await this.pool.query('INSERT INTO abilities (id, faction, name, kind, definition) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, name = EXCLUDED.name', [a.id, a.faction, a.name, a.kind, a]);
    for (const d of Object.values(DEATH_TYPES)) await this.pool.query('INSERT INTO death_animations (id, family, definition) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition', [d.id, d.family, d]);
    for (const a of ACHIEVEMENTS) await this.pool.query('INSERT INTO achievements (id, name, description, stat, threshold) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING', [a.id, a.name, a.description, a.stat, a.threshold]);
  }
  async close() { await this.pool.end(); }

  // ------------------------------------------------------------- users
  private userSelect = `
    SELECT u.*, p.avatar, s.*, st.data AS settings, cs.faction, cs.mode, cs.time_minutes, cs.time_increment, cs.ability_visibility,
      COALESCE((SELECT json_object_agg(piece_class, finisher_id) FROM selected_finishers f WHERE f.user_id = u.id), '{}') AS finishers,
      COALESCE((SELECT json_agg(achievement_id) FROM user_achievements a WHERE a.user_id = u.id), '[]') AS achievements
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN player_statistics s ON s.user_id = u.id
    LEFT JOIN settings st ON st.user_id = u.id
    LEFT JOIN chess_set_selections cs ON cs.user_id = u.id`;

  private toUser(r: Record<string, any>): UserRecord {
    return {
      passwordHash: r.password_hash ?? undefined, sessions: r.sessions ?? [],
      id: r.id, name: r.name, avatar: r.avatar ?? 'skull', tokenHash: r.token_hash, createdAt: new Date(r.created_at).getTime(), lastSeen: new Date(r.last_seen).getTime(),
      isAdmin: r.is_admin, bot: r.is_bot, rating: r.rating ?? 1200, ratingGames: r.rating_games ?? 0,
      stats: {
        wins: r.wins ?? 0, losses: r.losses ?? 0, draws: r.draws ?? 0, gamesPlayed: r.games_played ?? 0, currentStreak: r.current_streak ?? 0, longestStreak: r.longest_streak ?? 0,
        captures: r.captures ?? 0, kingDefeats: r.king_defeats ?? 0, finishersUsed: r.finishers_used ?? 0, customArmies: r.custom_armies ?? 0, kotbDefenses: r.kotb_defenses ?? 0,
        factionGames: r.faction_games ?? {}, pieceCaptures: r.piece_captures ?? {},
      },
      loadout: {
        faction: r.faction ?? 'remnants', mode: r.mode ?? 'standard', finishers: { pawn: 'pawn_f1', knight: 'knight_f1', bishop: 'bishop_f1', rook: 'rook_f1', queen: 'queen_f1', king: 'king_f1', ...(r.finishers ?? {}) },
        timeControl: { minutes: r.time_minutes ?? 10, incrementSec: r.time_increment ?? 0 }, abilityVisibility: r.ability_visibility ?? 'secret',
      },
      achievements: r.achievements ?? [], settings: r.settings ?? {}, credits: r.credits ?? DERBY_START_CREDITS,
    };
  }

  async getUser(id: string) { const r = await this.pool.query(`${this.userSelect} WHERE u.id = $1`, [id]); return r.rows[0] ? this.toUser(r.rows[0]) : undefined; }
  async getUserByTokenHash(h: string) { const r = await this.pool.query(`${this.userSelect} WHERE u.token_hash = $1 OR u.sessions ? $1`, [h]); return r.rows[0] ? this.toUser(r.rows[0]) : undefined; }
  async getUserByName(n: string) { const r = await this.pool.query(`${this.userSelect} WHERE lower(u.name) = lower($1)`, [n]); return r.rows[0] ? this.toUser(r.rows[0]) : undefined; }
  async topUsers(limit: number) { const r = await this.pool.query(`${this.userSelect} WHERE NOT u.is_bot AND s.rating_games > 0 ORDER BY s.rating DESC LIMIT $1`, [limit]); return r.rows.map((x) => this.toUser(x)); }

  async saveUser(u: UserRecord) {
    if (u.bot) return; // simulated players live in memory only
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO users (id, name, token_hash, is_admin, is_bot, created_at, last_seen, password_hash, sessions) VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0),to_timestamp($7/1000.0),$8,$9)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, token_hash=EXCLUDED.token_hash, is_admin=EXCLUDED.is_admin, last_seen=EXCLUDED.last_seen, password_hash=EXCLUDED.password_hash, sessions=EXCLUDED.sessions`,
        [u.id, u.name, u.tokenHash, u.isAdmin, u.bot, u.createdAt, u.lastSeen, u.passwordHash ?? null, JSON.stringify(u.sessions ?? [])]);
      await c.query(`INSERT INTO profiles (user_id, avatar, favorite_army) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET avatar=EXCLUDED.avatar, favorite_army=EXCLUDED.favorite_army`,
        [u.id, u.avatar, Object.entries(u.stats.factionGames).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null]);
      const s = u.stats;
      await c.query(`INSERT INTO player_statistics (user_id, rating, rating_games, wins, losses, draws, games_played, current_streak, longest_streak, captures, king_defeats, finishers_used, custom_armies, kotb_defenses, faction_games, piece_captures, credits)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (user_id) DO UPDATE SET rating=EXCLUDED.rating, rating_games=EXCLUDED.rating_games, wins=EXCLUDED.wins, losses=EXCLUDED.losses, draws=EXCLUDED.draws, games_played=EXCLUDED.games_played,
          current_streak=EXCLUDED.current_streak, longest_streak=EXCLUDED.longest_streak, captures=EXCLUDED.captures, king_defeats=EXCLUDED.king_defeats, finishers_used=EXCLUDED.finishers_used,
          custom_armies=EXCLUDED.custom_armies, kotb_defenses=EXCLUDED.kotb_defenses, faction_games=EXCLUDED.faction_games, piece_captures=EXCLUDED.piece_captures, credits=EXCLUDED.credits`,
        [u.id, u.rating, u.ratingGames, s.wins, s.losses, s.draws, s.gamesPlayed, s.currentStreak, s.longestStreak, s.captures, s.kingDefeats, s.finishersUsed, s.customArmies, s.kotbDefenses, s.factionGames, s.pieceCaptures, u.credits ?? DERBY_START_CREDITS]);
      await c.query('INSERT INTO settings (user_id, data) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET data=EXCLUDED.data', [u.id, u.settings]);
      const l = u.loadout;
      await c.query(`INSERT INTO chess_set_selections (user_id, faction, mode, time_minutes, time_increment, ability_visibility) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (user_id) DO UPDATE SET faction=EXCLUDED.faction, mode=EXCLUDED.mode, time_minutes=EXCLUDED.time_minutes, time_increment=EXCLUDED.time_increment, ability_visibility=EXCLUDED.ability_visibility`,
        [u.id, l.faction, l.mode, l.timeControl.minutes, l.timeControl.incrementSec, l.abilityVisibility]);
      for (const [pc, fid] of Object.entries(l.finishers)) {
        await c.query('INSERT INTO selected_finishers (user_id, piece_class, finisher_id) VALUES ($1,$2,$3) ON CONFLICT (user_id, piece_class) DO UPDATE SET finisher_id=EXCLUDED.finisher_id', [u.id, pc, fid]);
      }
      for (const a of u.achievements) await c.query('INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [u.id, a]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  /** Persist newly unlocked finishers (called by ProfileManager). */
  async recordUnlocks(userId: string, finisherIds: string[]) {
    for (const f of finisherIds) await this.pool.query('INSERT INTO unlocked_finishers (user_id, finisher_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, f]);
  }

  // ------------------------------------------------------------- games
  async saveGame(g: GameRecord) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO completed_games (id, arena_id, mode, ranked, time_control, ability_visibility, white_id, black_id, white, black, start_fen, result, armies, started_at, ended_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,to_timestamp($14/1000.0),to_timestamp($15/1000.0)) ON CONFLICT (id) DO NOTHING`,
        [g.id, g.arenaId, g.mode, g.ranked, g.timeControl, g.abilityVisibility, g.white.id, g.black.id, g.white, g.black, g.startFen, g.result, g.armies ?? null, g.startedAt, g.endedAt]);
      for (const m of g.moves) {
        await c.query('INSERT INTO move_history (game_id, ply, record) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [g.id, m.ply, m]);
        if (m.ability) await c.query('INSERT INTO ability_usage (game_id, user_id, ability_id, ply) VALUES ($1,$2,$3,$4)', [g.id, m.color === 'w' ? g.white.id : g.black.id, m.ability, m.ply]);
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  private async toGame(r: Record<string, any>, withMoves: boolean): Promise<GameRecord> {
    const moves = withMoves ? (await this.pool.query('SELECT record FROM move_history WHERE game_id = $1 ORDER BY ply', [r.id])).rows.map((x) => x.record) : [];
    return {
      id: r.id, arenaId: r.arena_id, mode: r.mode, ranked: r.ranked, timeControl: r.time_control, abilityVisibility: r.ability_visibility,
      white: r.white, black: r.black, startFen: r.start_fen, moves, result: r.result, armies: r.armies ?? undefined,
      startedAt: new Date(r.started_at).getTime(), endedAt: new Date(r.ended_at).getTime(),
    };
  }
  async getGame(id: string) { const r = await this.pool.query('SELECT * FROM completed_games WHERE id = $1', [id]); return r.rows[0] ? this.toGame(r.rows[0], true) : undefined; }
  async gamesForUser(userId: string, limit: number) {
    const r = await this.pool.query('SELECT * FROM completed_games WHERE white_id = $1 OR black_id = $1 ORDER BY ended_at DESC LIMIT $2', [userId, limit]);
    return Promise.all(r.rows.map((x) => this.toGame(x, false)));
  }
  async recentGames(limit: number) {
    const r = await this.pool.query('SELECT * FROM completed_games ORDER BY ended_at DESC LIMIT $1', [limit]);
    return Promise.all(r.rows.map((x) => this.toGame(x, false)));
  }

  async saveActiveGame(g: ActiveGameRecord) { await this.pool.query('INSERT INTO active_games (id, updated_at, data) VALUES ($1, now(), $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [g.id, g.data]); }
  async deleteActiveGame(id: string) { await this.pool.query('DELETE FROM active_games WHERE id = $1', [id]); }
  async listActiveGames() { const r = await this.pool.query('SELECT * FROM active_games'); return r.rows.map((x) => ({ id: x.id, updatedAt: new Date(x.updated_at).getTime(), data: x.data })); }

  // ------------------------------------------------------------- custom armies
  async saveArmy(a: StoredArmy) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO custom_chess_sets (id, owner_id, name, doctrine, palette, sequences, bindings, valid, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0),to_timestamp($10/1000.0))
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, doctrine=EXCLUDED.doctrine, palette=EXCLUDED.palette, sequences=EXCLUDED.sequences, bindings=EXCLUDED.bindings, valid=EXCLUDED.valid, updated_at=EXCLUDED.updated_at`,
        [a.id, a.ownerId, a.name, a.doctrine, a.palette, JSON.stringify(a.sequences), a.bindings, a.valid, a.createdAt, a.updatedAt]);
      await c.query('DELETE FROM custom_piece_mappings WHERE set_id = $1', [a.id]);
      for (const [pc, p] of Object.entries(a.pieces)) {
        if (p) await c.query('INSERT INTO custom_piece_mappings (set_id, piece_class, model_url, config) VALUES ($1,$2,$3,$4)', [a.id, pc, p.modelUrl, p]);
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  private async toArmy(r: Record<string, any>): Promise<StoredArmy> {
    const pieces: Record<PieceClass, CustomPiece | null> = { pawn: null, knight: null, bishop: null, rook: null, queen: null, king: null };
    for (const m of (await this.pool.query('SELECT piece_class, config FROM custom_piece_mappings WHERE set_id = $1', [r.id])).rows) pieces[m.piece_class as PieceClass] = m.config;
    return { id: r.id, ownerId: r.owner_id, name: r.name, doctrine: r.doctrine, palette: r.palette, pieces, sequences: r.sequences, bindings: r.bindings, valid: r.valid, createdAt: new Date(r.created_at).getTime(), updatedAt: new Date(r.updated_at).getTime() };
  }
  async getArmy(id: string) { const r = await this.pool.query('SELECT * FROM custom_chess_sets WHERE id = $1', [id]); return r.rows[0] ? this.toArmy(r.rows[0]) : undefined; }
  async armiesFor(ownerId: string) { const r = await this.pool.query('SELECT * FROM custom_chess_sets WHERE owner_id = $1 ORDER BY updated_at DESC', [ownerId]); return Promise.all(r.rows.map((x) => this.toArmy(x))); }
  async deleteArmy(id: string) { await this.pool.query('DELETE FROM custom_chess_sets WHERE id = $1', [id]); }

  // ------------------------------------------------------------- queue
  async saveQueue(entries: QueueRecord[]) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM matchmaking_queue');
      for (const e of entries) await c.query('INSERT INTO matchmaking_queue (user_id, kind, arena_id, mode, since) VALUES ($1,$2,$3,$4,$5)', [e.userId, e.kind, e.arenaId ?? null, e.mode, e.since]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async loadQueue() { const r = await this.pool.query('SELECT * FROM matchmaking_queue'); return r.rows.map((x) => ({ userId: x.user_id, kind: x.kind, arenaId: x.arena_id ?? undefined, mode: x.mode, since: Number(x.since) })); }
}
