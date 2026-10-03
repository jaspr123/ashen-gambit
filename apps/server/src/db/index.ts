import { config } from '../config.js';
import { JsonRepository } from './jsonRepository.js';
import { PgRepository } from './pgRepository.js';
import type { Repository } from './repository.js';

export async function createRepository(): Promise<Repository> {
  const repo: Repository = config.databaseUrl ? new PgRepository(config.databaseUrl) : new JsonRepository(config.dataDir);
  await repo.init();
  return repo;
}
export type { Repository } from './repository.js';
