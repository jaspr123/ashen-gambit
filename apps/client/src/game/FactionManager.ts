// FactionManager — one place that knows how to turn (faction, class, side)
// into a playable PieceVisual and its combat metadata, for built-in factions
// and for user-created custom armies alike.

import * as THREE from 'three';
import { WEAPON_AUDIO,
  FACTIONS, SYNTY_CLIP_MAP, defaultCombatRegistry, isBuiltinFaction, type BuiltinFactionId, type Color, type CustomArmy, type DeathTypeId, type FactionId,
  type GameAction, type PieceClass, type RigType,
} from '@ashen/shared';
import { AssetManager } from './AssetManager';
import { buildPedestal, buildProceduralPiece } from './pieces/ProceduralPieceFactory';
import { ProceduralVisual, TransformVisual, type PieceVisual } from './pieces/PieceVisual';
import { SkinnedVisual } from './pieces/SkinnedVisual';

export interface PieceCombatInfo {
  rig: RigType;
  deaths: DeathTypeId[];
  impactSound: string;
  swingSound: string;
  /** Gun/energy weapons: the shot itself (combat impacts fire it before the hit). */
  fireSound?: string;
  moveSound: string;
  unitName: string;
}

class FactionManagerImpl {
  private armies = new Map<string, CustomArmy>();
  quality = 1;

  /** Register a custom army and bind its authored kill sequences into the combat resolver chain. */
  registerArmy(a: CustomArmy) {
    this.armies.set(a.id, a);
    for (const [pc, seqId] of Object.entries(a.bindings)) {
      const seq = a.sequences.find((s) => s.id === seqId);
      if (seq) defaultCombatRegistry.register({ ...seq, id: `custom:${a.id}:${pc}:any` });
      else defaultCombatRegistry.unregister(`custom:${a.id}:${pc}:any`);
    }
  }
  army(id: FactionId): CustomArmy | undefined {
    return isBuiltinFaction(id) ? undefined : this.armies.get(id.slice('custom:'.length));
  }

  displayName(id: FactionId) { return isBuiltinFaction(id) ? FACTIONS[id].name : this.army(id)?.name ?? 'Custom Army'; }
  accent(id: FactionId) { return isBuiltinFaction(id) ? FACTIONS[id].palette.accent : this.army(id)?.palette.accent ?? '#e8a23a'; }

  combatInfo(id: FactionId, pc: PieceClass): PieceCombatInfo {
    if (isBuiltinFaction(id)) {
      const f = FACTIONS[id], p = f.pieces[pc];
      const w = WEAPON_AUDIO[p.weapon];
      return { rig: p.rig, deaths: p.deaths, impactSound: w?.hit ?? f.sounds.impact, swingSound: w?.swing ?? f.sounds.attack, fireSound: w?.fire, moveSound: f.sounds.move, unitName: p.unitName };
    }
    const p = this.army(id)?.pieces[pc];
    return { rig: p?.rig ?? 'static', deaths: p?.deaths ?? ['light_death'], impactSound: 'hit_metal', swingSound: 'swing_light', moveSound: 'step_boots', unitName: pc };
  }

  /** The faction whose procedural kit stands in when assets are missing. */
  private fallbackFaction(id: FactionId): BuiltinFactionId {
    if (isBuiltinFaction(id)) return id;
    return this.army(id)?.doctrine ?? 'remnants';
  }

  /** URLs that must be loaded before a match with these factions starts. */
  async preload(ids: FactionId[]) {
    const builtin = ids.filter(isBuiltinFaction);
    const custom = ids.map((i) => this.army(i)).filter(Boolean) as CustomArmy[];
    await Promise.allSettled([
      AssetManager.preloadFactions(builtin),
      ...custom.flatMap((a) => Object.values(a.pieces).filter(Boolean).map((p) => AssetManager.load(p!.modelUrl))),
    ]);
  }

  /** Create a visual synchronously from whatever is loaded; procedural if nothing is. */
  createVisual(id: FactionId, pc: PieceClass, side: Color): PieceVisual {
    const custom = this.army(id);
    if (custom) {
      const v = this.customVisual(custom, pc, side);
      if (v) return v;
    } else if (isBuiltinFaction(id)) {
      const v = this.builtinGlbVisual(id, pc, side);
      if (v) return v;
    }
    return new ProceduralVisual(buildProceduralPiece(this.fallbackFaction(id), pc, side), this.quality);
  }

  /** Derby runner: variant 'b' is the second jockey/horse built for the Derby; 'a' is the faction knight. */
  createDerbyVisual(id: BuiltinFactionId, variant: 'w' | 'b'): PieceVisual {
    const d = variant === 'b' ? AssetManager.manifest?.derby?.[id]?.b : undefined;
    const gltf = d ? AssetManager.peek(`/assets/${d.file}`) : null;
    const model = d && gltf ? AssetManager.cloneNode(gltf, d.node) : null;
    if (!d || !gltf || !model) return this.createVisual(id, 'knight', variant);
    const holder = new THREE.Group();
    holder.add(model);
    return new SkinnedVisual({ model: holder, clips: gltf.animations, clipMap: { ...SYNTY_CLIP_MAP, ...d.clips }, base: null, baseEmissive: [], mechanical: false });
  }

  private builtinGlbVisual(id: BuiltinFactionId, pc: PieceClass, side: Color): PieceVisual | null {
    const manifest = AssetManager.manifest;
    const piece = manifest?.factions[id]?.pieces[pc];
    if (!piece) return null;
    const gltf = AssetManager.peek(`/assets/${piece.file}`);
    if (!gltf) return null;
    const model = AssetManager.cloneNode(gltf, piece.node);
    if (!model) return null;
    const lib = piece.animations === 'self' || !manifest?.animations ? null : AssetManager.peek(`/assets/${manifest.animations.humanoid}`);
    const clips = piece.animations === 'self' ? gltf.animations : lib?.animations ?? [];
    if (piece.scale) model.scale.multiplyScalar(piece.scale);
    const holder = new THREE.Group();
    holder.add(model);
    // Models face +Z; pieces are rotated by the actor, so nothing else to do here.
    tintForSide(model, side);
    const ped = buildPedestal(pc, side, FACTIONS[id].palette.base);
    return new SkinnedVisual({
      model: holder, clips, clipMap: { ...SYNTY_CLIP_MAP, ...piece.clips }, base: ped.group, baseEmissive: ped.emissive,
      mechanical: piece.mechanical ?? FACTIONS[id].pieces[pc].rig === 'mechanical',
    });
  }

  private customVisual(a: CustomArmy, pc: PieceClass, side: Color): PieceVisual | null {
    const p = a.pieces[pc];
    if (!p) return null;
    const gltf = AssetManager.peek(p.modelUrl);
    if (!gltf) return null;
    const model = SkeletonCloneScene(gltf.scene);
    const holder = new THREE.Group();
    holder.add(model);
    model.scale.setScalar(p.transform.scale);
    model.rotation.set(...(p.transform.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]));
    model.position.set(...p.transform.offset);
    tintForSide(model, side);
    const ped = buildPedestal(pc, side, a.palette.base);
    const mapped = Object.keys(p.clipMap).length > 0 && gltf.animations.length > 0;
    if (mapped || p.fallback !== 'transform') {
      return new SkinnedVisual({ model: holder, clips: gltf.animations, clipMap: p.clipMap as Partial<Record<GameAction, string>>, base: ped.group, baseEmissive: ped.emissive, mechanical: p.fallback === 'mechanical' });
    }
    const obj = new THREE.Group();
    obj.add(ped.group);
    const body = new THREE.Group();
    body.position.y = 0.05;
    body.add(holder);
    obj.add(body);
    obj.updateMatrixWorld(true);
    const h = new THREE.Box3().setFromObject(holder).max.y;
    return new TransformVisual(obj, body, ped.group, h, p.rig === 'mechanical');
  }
}

function SkeletonCloneScene(scene: THREE.Object3D) {
  // Lazy import keeps SkeletonUtils out of the FactionManager's static deps.
  return AssetManager.cloneNode({ scene } as never, scene.name || (scene.name = 'root')) ?? scene.clone(true);
}

/** Subtle side tint so mirror matches (same army on both sides) stay readable. */
function tintForSide(model: THREE.Object3D, side: Color) {
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
      const c = x.clone() as THREE.MeshStandardMaterial;
      if (c.color) c.color.lerp(new THREE.Color(side === 'w' ? '#f4ead8' : '#2a1410'), side === 'w' ? 0.12 : 0.35);
      return c;
    });
    m.material = Array.isArray(m.material) ? mats : mats[0];
  });
}

export const FactionManager = new FactionManagerImpl();
