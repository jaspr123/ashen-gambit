// Custom army format + validation, shared so the server can re-validate
// whatever the client claims before allowing an army into public matchmaking.

import { z } from 'zod';
import { PIECE_KEYS, type PieceClass } from './types.js';
import { GAME_ACTIONS, REQUIRED_ACTIONS, ANIMATION_LIMITS, type GameAction } from './game-data/animations.js';
import { DEATH_TYPE_IDS } from './game-data/deaths.js';
import { CombatSequenceSchema } from './combat/timeline.js';

export const PIECE_CLASSES: PieceClass[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

export const ModelStatsSchema = z.object({
  loadOk: z.boolean(),
  triangles: z.number().int().min(0),
  materials: z.number().int().min(0),
  textures: z.number().int().min(0),
  missingTextures: z.array(z.string()).max(50),
  bones: z.number().int().min(0),
  skeletonOk: z.boolean(),
  clips: z.array(z.object({ name: z.string().max(120), duration: z.number().min(0).max(600) })).max(200),
  /** Bounding box after the user's transform, in board squares (1 = one square). */
  size: z.tuple([z.number(), z.number(), z.number()]),
  /** Lowest point after transform; should sit on the board (≈0). */
  minY: z.number(),
  fileBytes: z.number().int().min(0),
});
export type ModelStats = z.infer<typeof ModelStatsSchema>;

const vec3 = z.tuple([z.number().min(-100).max(100), z.number().min(-100).max(100), z.number().min(-100).max(100)]);

export const CustomPieceSchema = z.object({
  pieceClass: z.enum(PIECE_CLASSES as [PieceClass, ...PieceClass[]]),
  modelUrl: z.string().max(400),
  fileName: z.string().max(200),
  format: z.enum(['glb', 'gltf', 'fbx', 'obj']),
  transform: z.object({ scale: z.number().min(0.0001).max(1000), rotation: vec3, offset: vec3 }),
  rig: z.enum(['humanoid', 'mechanical', 'vehicle', 'creature', 'static']),
  /** Procedural family used for any action that has no clip mapped. */
  fallback: z.enum(['humanoid', 'mechanical', 'transform']),
  clipMap: z.record(z.enum(GAME_ACTIONS), z.string().max(120)),
  /** Actions the user explicitly accepted a procedural fallback for. */
  acceptedFallbacks: z.array(z.enum(GAME_ACTIONS)).max(GAME_ACTIONS.length),
  deaths: z.array(z.enum(DEATH_TYPE_IDS)).min(1).max(DEATH_TYPE_IDS.length),
  thumbnail: z.string().max(400_000).optional(),
  stats: ModelStatsSchema,
});
export type CustomPiece = z.infer<typeof CustomPieceSchema>;

export const CustomArmySchema = z.object({
  id: z.string().max(64),
  ownerId: z.string().max(64).optional(),
  name: z.string().min(1).max(40),
  /** Which built-in faction's War Chess abilities this army fights with. */
  doctrine: z.enum(['remnants', 'machines', 'wastelanders', 'vault']),
  palette: z.object({ primary: z.string().max(9), accent: z.string().max(9), base: z.string().max(9) }),
  pieces: z.object({
    pawn: CustomPieceSchema.nullable(), knight: CustomPieceSchema.nullable(), bishop: CustomPieceSchema.nullable(),
    rook: CustomPieceSchema.nullable(), queen: CustomPieceSchema.nullable(), king: CustomPieceSchema.nullable(),
  }),
  /** Custom kill sequences authored in the Kill Sequence Editor. */
  sequences: z.array(CombatSequenceSchema).max(60),
  /** pieceClass -> sequence id used when that class captures. */
  bindings: z.record(z.string(), z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type CustomArmy = z.infer<typeof CustomArmySchema>;

export interface ValidationIssue {
  severity: 'error' | 'warning';
  piece?: PieceClass;
  code: string;
  message: string;
}

export const PERFORMANCE_BUDGET = {
  maxTrianglesPerPiece: 25_000,
  warnTrianglesPerPiece: 12_000,
  maxBones: 120,
  maxMaterials: 8,
  maxTextures: 8,
  maxFileBytes: 12 * 1024 * 1024,
  /** Footprint must fit a square; height between these (in squares). */
  maxFootprint: 1.15,
  minHeight: 0.25,
  maxHeight: 2.4,
};

function clipDuration(p: CustomPiece, action: GameAction) {
  const name = p.clipMap[action];
  return name ? p.stats.clips.find((c) => c.name === name)?.duration : undefined;
}

export function validateCustomArmy(army: CustomArmy, scope: 'public' | 'private'): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, piece?: PieceClass) => issues.push({ severity: 'error', code, message, piece });
  const warn = (code: string, message: string, piece?: PieceClass) => issues.push({ severity: 'warning', code, message, piece });

  for (const pc of PIECE_CLASSES) {
    const p = army.pieces[pc];
    if (!p) { err('missing_class', `No model assigned to the ${pc}.`, pc); continue; }
    const s = p.stats;
    if (!s.loadOk) err('load_failed', 'Model failed to load.', pc);
    if (s.missingTextures.length) err('missing_textures', `Missing textures: ${s.missingTextures.slice(0, 4).join(', ')}`, pc);
    if (!s.skeletonOk) err('broken_skeleton', 'Skeleton/skin bindings are broken.', pc);
    const [w, h, d] = s.size;
    if (Math.max(w, d) > PERFORMANCE_BUDGET.maxFootprint) err('too_wide', `Footprint ${Math.max(w, d).toFixed(2)} squares exceeds ${PERFORMANCE_BUDGET.maxFootprint}.`, pc);
    if (h < PERFORMANCE_BUDGET.minHeight) err('too_small', `Height ${h.toFixed(2)} is too small to read on the board.`, pc);
    if (h > PERFORMANCE_BUDGET.maxHeight) err('too_tall', `Height ${h.toFixed(2)} squares exceeds ${PERFORMANCE_BUDGET.maxHeight}.`, pc);
    if (Math.abs(s.minY) > 0.08) warn('not_grounded', 'Model does not sit on the board (adjust the origin offset).', pc);
    if (s.triangles > PERFORMANCE_BUDGET.maxTrianglesPerPiece) err('too_many_triangles', `${s.triangles} triangles exceeds the ${PERFORMANCE_BUDGET.maxTrianglesPerPiece} budget.`, pc);
    else if (s.triangles > PERFORMANCE_BUDGET.warnTrianglesPerPiece) warn('heavy_mesh', `${s.triangles} triangles is heavy; consider an LOD.`, pc);
    if (s.bones > PERFORMANCE_BUDGET.maxBones) err('too_many_bones', `${s.bones} bones exceeds ${PERFORMANCE_BUDGET.maxBones}.`, pc);
    if (s.materials > PERFORMANCE_BUDGET.maxMaterials) warn('many_materials', `${s.materials} materials increases draw calls.`, pc);
    if (s.fileBytes > PERFORMANCE_BUDGET.maxFileBytes) err('file_too_large', 'Model file exceeds 12 MB.', pc);

    for (const a of REQUIRED_ACTIONS) {
      const mapped = p.clipMap[a];
      if (mapped && !s.clips.some((c) => c.name === mapped)) err('clip_missing', `${a} is mapped to "${mapped}" which does not exist in the model.`, pc);
      if (!mapped && !p.acceptedFallbacks.includes(a)) {
        if (scope === 'public') err('action_unmapped', `${a} has no clip. Map one or accept the procedural fallback.`, pc);
        else warn('action_fallback', `${a} will use the procedural fallback.`, pc);
      }
    }
    const lim = ANIMATION_LIMITS.maxClipSeconds;
    const checks: [GameAction, number][] = [['ATTACK_PRIMARY', lim.attack], ['ATTACK_HEAVY', lim.attack], ['HIT_LIGHT', lim.hit], ['HIT_HEAVY', lim.hit], ['DEATH_LIGHT', lim.death], ['DEATH_HEAVY', lim.death], ['MOVE', lim.move]];
    for (const [a, max] of checks) {
      const dur = clipDuration(p, a);
      if (dur !== undefined && dur > max) err('clip_too_long', `${a} clip is ${dur.toFixed(1)}s (max ${max}s).`, pc);
    }
    if (!p.deaths.length) err('no_death', 'No death type assigned.', pc);
  }

  for (const seq of army.sequences) {
    const max = seq.id.includes(':king') ? ANIMATION_LIMITS.maxKingSequenceSeconds : ANIMATION_LIMITS.maxSequenceSeconds;
    if (seq.duration > max) err('sequence_too_long', `Kill sequence "${seq.name}" is ${seq.duration.toFixed(1)}s (max ${max}s).`);
    if (!seq.events.some((e) => e.type === 'impact')) warn('sequence_no_impact', `Kill sequence "${seq.name}" has no impact event.`);
  }
  for (const [pc, seqId] of Object.entries(army.bindings)) {
    if (!army.sequences.some((s) => s.id === seqId)) err('binding_missing', `The ${pc} is bound to a missing kill sequence.`, pc as PieceClass);
  }
  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

export function customFactionId(armyId: string) { return `custom:${armyId}` as const; }
export { PIECE_KEYS };
