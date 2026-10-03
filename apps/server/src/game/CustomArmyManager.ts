// Server-side custom army storage and validation. Uploaded models arrive as
// GLB (the client normalises GLTF/FBX/OBJ/ZIP to GLB before upload) and are
// re-inspected here; the stored stats are the server's, not the client's.

import fs from 'node:fs/promises';
import path from 'node:path';
import { CustomArmySchema, PIECE_CLASSES, validateCustomArmy, type CustomArmy, type ValidationIssue } from '@ashen/shared';
import { config } from '../config.js';
import type { Repository } from '../db/index.js';
import type { UserRecord } from '../db/repository.js';
import { inspectGlb } from './glbInspect.js';
import { newId, type ProfileManager } from './ProfileManager.js';

export class CustomArmyManager {
  constructor(private repo: Repository, private profiles: ProfileManager) {}

  async storeUpload(user: UserRecord, data: Buffer): Promise<{ url: string; facts: ReturnType<typeof inspectGlb> }> {
    if (data.length > config.maxUploadBytes) throw new Error('file_too_large');
    const facts = inspectGlb(data);
    if (!facts.ok) throw new Error(`invalid_model:${facts.error}`);
    const dir = path.join(config.uploadDir, user.id);
    await fs.mkdir(dir, { recursive: true });
    const name = `${newId()}.glb`;
    await fs.writeFile(path.join(dir, name), data);
    return { url: `/uploads/${user.id}/${name}`, facts };
  }

  private async factsFor(url: string) {
    const m = /^\/uploads\/([\w-]+)\/([\w-]+\.glb)$/.exec(url);
    if (!m) return null;
    try { return inspectGlb(await fs.readFile(path.join(config.uploadDir, m[1], m[2]))); } catch { return null; }
  }

  async save(user: UserRecord, raw: unknown): Promise<{ army: CustomArmy; valid: boolean; issues: ValidationIssue[] }> {
    const parsed = CustomArmySchema.parse(raw);
    const existing = parsed.id ? await this.repo.getArmy(parsed.id) : undefined;
    if (existing && existing.ownerId !== user.id) throw new Error('not_owner');
    const army: CustomArmy = { ...parsed, id: existing?.id ?? newId('army_'), ownerId: user.id, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() };
    // Sequences are namespaced to this army so they cannot override other factions' fights.
    army.sequences = army.sequences.map((s) => ({ ...s, id: s.id.startsWith(`custom:${army.id}:`) ? s.id : `custom:${army.id}:${s.id}` }));
    army.bindings = Object.fromEntries(Object.entries(army.bindings).map(([k, v]) => [k, v.startsWith(`custom:${army.id}:`) ? v : `custom:${army.id}:${v}`]));
    // Replace client-reported model facts with server-measured ones.
    for (const pc of PIECE_CLASSES) {
      const p = army.pieces[pc];
      if (!p) continue;
      if (!p.modelUrl.startsWith(`/uploads/${user.id}/`)) throw new Error('foreign_model');
      const facts = await this.factsFor(p.modelUrl);
      if (!facts || !facts.ok) { p.stats.loadOk = false; continue; }
      p.stats.triangles = facts.triangles;
      p.stats.bones = facts.bones;
      p.stats.materials = facts.materials;
      p.stats.textures = facts.textures;
      p.stats.missingTextures = facts.missingTextures;
      p.stats.clips = facts.clips;
    }
    const { ok, issues } = validateCustomArmy(army, 'public');
    await this.repo.saveArmy({ ...army, ownerId: user.id, valid: ok });
    if (!existing) {
      user.stats.customArmies++;
      await this.profiles.save(user);
    }
    return { army, valid: ok, issues };
  }

  list(userId: string) { return this.repo.armiesFor(userId); }
  get(id: string) { return this.repo.getArmy(id); }

  async remove(user: UserRecord, id: string) {
    const a = await this.repo.getArmy(id);
    if (!a || a.ownerId !== user.id) throw new Error('not_owner');
    await this.repo.deleteArmy(id);
  }

  async owns(userId: string, id: string) { const a = await this.repo.getArmy(id); return !!a && a.ownerId === userId; }

  /** Public matchmaking requires a fully valid army. Private/local games accept fallbacks. */
  async publicEligibility(u: UserRecord): Promise<string | null> {
    if (!u.loadout.faction.startsWith('custom:')) return null;
    const a = await this.repo.getArmy(u.loadout.faction.slice('custom:'.length));
    if (!a) return 'army_missing';
    return a.valid ? null : 'army_not_validated';
  }
}
