-- Ashen Gambit — PostgreSQL schema. Idempotent: safe to run repeatedly.
-- Run with: npm run db:migrate -w @ashen/server   (requires DATABASE_URL)

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  is_bot        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_name_lower ON users (lower(name));
-- Accounts: optional password + per-device sessions (guests have neither).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  avatar        TEXT NOT NULL DEFAULT 'skull',
  favorite_army TEXT,
  bio           TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS player_statistics (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rating          INTEGER NOT NULL DEFAULT 1200,
  rating_games    INTEGER NOT NULL DEFAULT 0,
  wins            INTEGER NOT NULL DEFAULT 0,
  losses          INTEGER NOT NULL DEFAULT 0,
  draws           INTEGER NOT NULL DEFAULT 0,
  games_played    INTEGER NOT NULL DEFAULT 0,
  current_streak  INTEGER NOT NULL DEFAULT 0,
  longest_streak  INTEGER NOT NULL DEFAULT 0,
  captures        INTEGER NOT NULL DEFAULT 0,
  king_defeats    INTEGER NOT NULL DEFAULT 0,
  finishers_used  INTEGER NOT NULL DEFAULT 0,
  custom_armies   INTEGER NOT NULL DEFAULT 0,
  kotb_defenses   INTEGER NOT NULL DEFAULT 0,
  faction_games   JSONB NOT NULL DEFAULT '{}',
  piece_captures  JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS stats_rating ON player_statistics (rating DESC);
-- Wasteland Derby bank balance.
ALTER TABLE player_statistics ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 1000;

CREATE TABLE IF NOT EXISTS settings (
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data      JSONB NOT NULL DEFAULT '{}'
);

-- Cosmetic + army selection (the loadout).
CREATE TABLE IF NOT EXISTS player_cosmetic_selections (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  board_skin          TEXT NOT NULL DEFAULT 'default',
  emote_set           TEXT NOT NULL DEFAULT 'default',
  data                JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS chess_set_selections (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  faction             TEXT NOT NULL DEFAULT 'remnants',
  mode                TEXT NOT NULL DEFAULT 'standard',
  time_minutes        INTEGER NOT NULL DEFAULT 10,
  time_increment      INTEGER NOT NULL DEFAULT 0,
  ability_visibility  TEXT NOT NULL DEFAULT 'secret'
);

-- Finishers.
CREATE TABLE IF NOT EXISTS unlocked_finishers (
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  finisher_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, finisher_id)
);
CREATE TABLE IF NOT EXISTS selected_finishers (
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  piece_class TEXT NOT NULL,
  finisher_id TEXT NOT NULL,
  PRIMARY KEY (user_id, piece_class)
);

-- Content registries (mirrors of /game-data so analytics + admin tools can join on them).
CREATE TABLE IF NOT EXISTS abilities (
  id TEXT PRIMARY KEY, faction TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, definition JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS animations (
  id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, definition JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS death_animations (
  id TEXT PRIMARY KEY, family TEXT NOT NULL, definition JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, stat TEXT NOT NULL, threshold INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

-- Custom armies.
CREATE TABLE IF NOT EXISTS custom_chess_sets (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  doctrine    TEXT NOT NULL,
  palette     JSONB NOT NULL,
  sequences   JSONB NOT NULL DEFAULT '[]',
  bindings    JSONB NOT NULL DEFAULT '{}',
  valid       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_sets_owner ON custom_chess_sets (owner_id);
CREATE TABLE IF NOT EXISTS custom_piece_mappings (
  set_id      TEXT REFERENCES custom_chess_sets(id) ON DELETE CASCADE,
  piece_class TEXT NOT NULL,
  model_url   TEXT NOT NULL,
  config      JSONB NOT NULL,   -- transform, rig, clip map, deaths, stats
  PRIMARY KEY (set_id, piece_class)
);

-- Games.
CREATE TABLE IF NOT EXISTS active_games (
  id          TEXT PRIMARY KEY,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  data        JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS completed_games (
  id                 TEXT PRIMARY KEY,
  arena_id           TEXT NOT NULL,
  mode               TEXT NOT NULL,
  ranked             BOOLEAN NOT NULL,
  time_control       JSONB NOT NULL,
  ability_visibility TEXT NOT NULL,
  white_id           TEXT NOT NULL,
  black_id           TEXT NOT NULL,
  white              JSONB NOT NULL,
  black              JSONB NOT NULL,
  start_fen          TEXT NOT NULL,
  result             JSONB NOT NULL,
  armies             JSONB,
  started_at         TIMESTAMPTZ NOT NULL,
  ended_at           TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS games_white ON completed_games (white_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS games_black ON completed_games (black_id, ended_at DESC);
CREATE TABLE IF NOT EXISTS move_history (
  game_id     TEXT REFERENCES completed_games(id) ON DELETE CASCADE,
  ply         INTEGER NOT NULL,
  record      JSONB NOT NULL,
  PRIMARY KEY (game_id, ply)
);
CREATE TABLE IF NOT EXISTS ability_usage (
  id          BIGSERIAL PRIMARY KEY,
  game_id     TEXT REFERENCES completed_games(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  ability_id  TEXT NOT NULL,
  ply         INTEGER NOT NULL
);

-- Matchmaking queue (persisted so a restart does not drop waiting players).
CREATE TABLE IF NOT EXISTS matchmaking_queue (
  user_id   TEXT PRIMARY KEY,
  kind      TEXT NOT NULL,
  arena_id  TEXT,
  mode      TEXT NOT NULL,
  since     BIGINT NOT NULL
);
