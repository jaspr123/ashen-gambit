import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..');

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3001),
  production: env.NODE_ENV === 'production',
  /** postgres://user:pass@host:5432/db — when unset, a JSON file store is used. */
  databaseUrl: env.DATABASE_URL ?? '',
  dataDir: env.DATA_DIR ?? path.join(SERVER_ROOT, 'data'),
  uploadDir: env.UPLOAD_DIR ?? path.join(SERVER_ROOT, 'uploads'),
  clientDist: env.CLIENT_DIST ?? path.join(REPO_ROOT, 'apps', 'client', 'dist'),
  corsOrigin: env.CORS_ORIGIN ?? '*',
  /** Dev tools (bots, admin panel actions) — on by default outside production. */
  devTools: env.DEV_TOOLS ? env.DEV_TOOLS === '1' : env.NODE_ENV !== 'production',
  /** Comma-separated usernames that always get admin rights. */
  adminNames: (env.ADMIN_NAMES ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  maxUploadBytes: 12 * 1024 * 1024,
  /** Number of King-of-the-Board tables kept open in the lobby. */
  kotbArenas: Number(env.KOTB_ARENAS ?? 2),
  /** Short Derby phases + cheap odds pricing (tests). */
  derbyFast: env.DERBY_FAST === '1',
  /** DERBY=0 disables the race cycle (tests that do not need it). */
  derbyEnabled: env.DERBY !== '0',
  /** Pre-match army/sabotage draft length (ms); 0 skips it (tests). */
  pickMs: Number(env.PICK_MS ?? 20_000),
  /** Secret that promotes the signed-in account to admin (Profile -> Admin access). Empty = disabled. */
  adminCode: env.ADMIN_CODE ?? '',
};
