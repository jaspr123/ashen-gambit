// Applies schema.sql to DATABASE_URL. The server also runs this on boot.
import { config } from '../config.js';
import { PgRepository } from './pgRepository.js';

if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set — nothing to migrate (the JSON store needs no migration).');
  process.exit(1);
}
const repo = new PgRepository(config.databaseUrl);
await repo.init();
await repo.close();
console.log('Schema applied.');
