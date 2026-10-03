// BoardStage — the imperative 3D runtime for the chessboard: board geometry,
// piece actors (PieceManager), overlays, FX, deaths, tweens and the combat
// director. React only mounts it; game logic talks to it directly so fights
// can be choreographed frame-accurately without re-rendering components.

import * as THREE from 'three';
import { type Color, type FactionId, type PieceType, type Square } from '@ashen/shared';
import { AudioManager } from '../core/AudioManager';
import { StageAudio } from './audioBridge';
import { buildBoard, type BoardBuild } from './BoardBuilder';
import { CameraDirector } from './CameraDirector';
import { CombatDirector } from './CombatDirector';
import { worldToSquare } from './coords';
import { DeathAnimationManager } from './DeathAnimationManager';
import { FactionManager } from './FactionManager';
import { FxSystem } from './FxSystem';
import { PieceActor } from './PieceActor';
import { SquareOverlays, type OverlayState } from './SquareOverlays';
import { TweenRunner } from './tween';

export interface StageServices {
  fx: FxSystem;
  deaths: DeathAnimationManager;
  tweens: TweenRunner;
  audio: StageAudio;
  camera: CameraDirector | null;
  slowmo(scale: number, seconds: number): void;
  wait(seconds: number): Promise<void>;
  freezeOthers(keep: PieceActor[], on: boolean): void;
  duck(on: boolean): void;
  setFightFocus(a: PieceActor | null, b: PieceActor | null): void;
}

export class BoardStage implements StageServices {
  readonly root = new THREE.Group();
  readonly fx = new FxSystem();
  readonly tweens = new TweenRunner();
  readonly audio = new StageAudio();
  readonly overlays = new SquareOverlays();
  readonly deaths: DeathAnimationManager;
  readonly combat: CombatDirector;
  readonly camera: CameraDirector;
  readonly actors: PieceActor[] = [];
  factions: Record<Color, FactionId> = { w: 'remnants', b: 'machines' };
  board: BoardBuild | null = null;
  /** Global animation clock multiplier (slow-motion windows). */
  private slow = { scale: 1, remaining: 0 };
  paused = false;
  private ducked = false;
  readonly raycaster = new THREE.Raycaster();

  constructor(camera: THREE.PerspectiveCamera, opts: { textureSize: number; detail: number }) {
    this.root.name = 'stage';
    this.camera = new CameraDirector(camera);
    this.audio.camera = camera;
    this.deaths = new DeathAnimationManager(this.fx, this.audio);
    this.combat = new CombatDirector(this);
    this.rebuildBoard(opts.textureSize, opts.detail);
    this.root.add(this.overlays.group, this.fx.group);
  }

  rebuildBoard(textureSize: number, detail: number) {
    if (this.board) this.root.remove(this.board.group);
    this.board = buildBoard(textureSize, detail);
    this.root.add(this.board.group);
  }

  showLabels(on: boolean) { this.board?.labels.forEach((l) => (l.visible = on)); }

  // ------------------------------------------------------------------ StageServices
  slowmo(scale: number, seconds: number) { this.slow = { scale, remaining: seconds }; }
  wait(seconds: number) { return this.tweens.to(seconds, () => {}); }
  freezeOthers(keep: PieceActor[], on: boolean) {
    for (const a of this.actors) if (!keep.includes(a)) a.visual.setPaused(on);
  }
  duck(on: boolean) {
    if (on === this.ducked) return;
    this.ducked = on;
    if (on) AudioManager.duck(0.2); else AudioManager.unduck();
  }
  setFightFocus(a: PieceActor | null, b: PieceActor | null) {
    // Bystanders glance toward the fight — keeps the board feeling alive.
    for (const x of this.actors) {
      if (x === a || x === b || !x.alive) continue;
      x.visual.setPaused(false);
    }
  }

  // ------------------------------------------------------------------ PieceManager
  actorAt(s: Square): PieceActor | undefined {
    return this.actors.find((a) => a.alive && a.square === s);
  }

  createActor(type: PieceType, color: Color, s: Square, faction = this.factions[color]) {
    const pc = ({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' } as const)[type];
    const actor = new PieceActor(FactionManager.createVisual(faction, pc, color), type, color, faction, s);
    this.actors.push(actor);
    this.root.add(actor.root);
    return actor;
  }

  removeActor(a: PieceActor) {
    const i = this.actors.indexOf(a);
    if (i >= 0) this.actors.splice(i, 1);
    a.dispose();
  }

  /** Make the board match a FEN exactly (no animation). Reuses matching actors. */
  setPosition(fen: string) {
    const rows = fen.split(' ')[0].split('/');
    const want = new Map<Square, { type: PieceType; color: Color }>();
    rows.forEach((row, ri) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += Number(ch); continue; }
        const s = `${'abcdefgh'[f]}${8 - ri}` as Square;
        want.set(s, { type: ch.toLowerCase() as PieceType, color: ch === ch.toUpperCase() ? 'w' : 'b' });
        f++;
      }
    });
    const keep = new Set<PieceActor>();
    for (const [s, p] of want) {
      const existing = this.actors.find((a) => a.alive && !keep.has(a) && a.square === s && a.type === p.type && a.color === p.color && a.faction === this.factions[p.color]);
      if (existing) {
        keep.add(existing);
        existing.placeAt(s);
        existing.root.visible = true;
        // Only pieces interrupted mid-action need a reset; resetting idle pieces restarts their clips (pops/T-pose).
        if (existing.busy) { existing.busy = false; existing.visual.reset(); }
      } else keep.add(this.createActor(p.type, p.color, s));
    }
    for (const a of [...this.actors]) if (!keep.has(a)) this.removeActor(a);
  }

  /** Rebuild every actor (e.g. after factions change or GLBs finished loading). */
  rebuildActors(fen: string) {
    for (const a of [...this.actors]) this.removeActor(a);
    this.setPosition(fen);
  }

  clearPieces() { for (const a of [...this.actors]) this.removeActor(a); }

  setOverlays(s: OverlayState) { this.overlays.set(s); }

  // ------------------------------------------------------------------ picking
  pick(ndc: THREE.Vector2, cam: THREE.Camera): { square: Square | null; actor: PieceActor | null } {
    this.raycaster.setFromCamera(ndc, cam);
    const hitboxes = this.actors.filter((a) => a.alive && a.root.visible).map((a) => a.hitbox);
    const hits = this.raycaster.intersectObjects(hitboxes, false);
    if (hits.length) {
      const actor = hits[0].object.userData.actor as PieceActor;
      return { square: actor.square, actor };
    }
    if (!this.board) return { square: null, actor: null };
    const p = this.raycaster.intersectObject(this.board.pickPlane, false)[0];
    if (!p) return { square: null, actor: null };
    const s = worldToSquare(p.point);
    return { square: s, actor: s ? this.actorAt(s) ?? null : null };
  }

  // ------------------------------------------------------------------ frame
  update(realDt: number) {
    const dtReal = Math.min(realDt, 1 / 20);
    let scale = 1;
    if (this.slow.remaining > 0) { this.slow.remaining -= dtReal; scale = this.slow.scale; }
    const dt = this.paused ? 0 : dtReal * scale;
    this.tweens.update(dt);
    this.combat.update(dt);
    this.deaths.update(dt);
    for (const a of this.actors) a.update(dt);
    this.fx.update(dt);
    this.overlays.update(dtReal);
    this.camera.update(dt, dtReal);
    // Lamp flicker.
    if (this.board) for (const [i, l] of this.board.lamps.entries()) l.intensity = 5 * (0.92 + Math.sin(performance.now() * 0.013 + i * 7) * 0.04 + (Math.random() < 0.01 ? -0.5 : 0));
  }

  /** Step the simulation with a fixed dt (Combat Laboratory scrubbing). */
  step(seconds: number, fixed = 1 / 60) {
    let t = 0;
    while (t < seconds - 1e-6) {
      const dt = Math.min(fixed, seconds - t);
      this.tweens.update(dt);
      this.combat.update(dt);
      this.deaths.update(dt);
      for (const a of this.actors) a.update(dt);
      this.fx.update(dt);
      t += dt;
    }
  }

  dispose() {
    this.clearPieces();
    this.root.clear();
  }
}
