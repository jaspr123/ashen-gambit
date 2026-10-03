// CombatDirector — choreographs everything that happens on the board when a
// move resolves: walking moves, knight leaps, castling, captures (resolved
// through the shared CombatResolver fallback chain) and the checkmate King
// Defeat sequence. Nothing ever cuts away from the board.

import * as THREE from 'three';
import {
  CombatRegistry, PIECE_KEYS, defaultCombatRegistry, type CombatSequence, type DeathTypeId, type ResolvedCombat,
} from '@ashen/shared';
import type { StageServices } from './BoardStage';
import { facingYaw, squareToWorld, yawToward } from './coords';
import { CombatTimelinePlayer } from './CombatTimelineManager';
import { FactionManager } from './FactionManager';
import type { PieceActor } from './PieceActor';

export interface CaptureOptions {
  finisherId: string;
  seed: number;
  /** Playback multiplier (settings). 0 = skip the fight entirely. */
  speed: number;
  /** Force a specific sequence (Combat Laboratory). */
  sequence?: CombatSequence;
  deathType?: DeathTypeId;
}

export class CombatDirector {
  /** Client registry: built-ins plus any custom-army sequences registered at runtime. */
  readonly registry: CombatRegistry = defaultCombatRegistry;
  current: CombatTimelinePlayer | null = null;
  /** Playback multiplier applied to the running timeline. */
  speed = 1;
  lastResolved: ResolvedCombat | null = null;

  constructor(private s: StageServices) {}

  resolve(attacker: PieceActor, defender: PieceActor, finisherId: string, seed: number): ResolvedCombat {
    const ai = FactionManager.combatInfo(attacker.faction, attacker.pieceClass);
    const di = FactionManager.combatInfo(defender.faction, defender.pieceClass);
    return this.registry.resolve({
      attackerClass: attacker.pieceClass, defenderClass: defender.pieceClass, attackerFaction: attacker.faction, defenderFaction: defender.faction,
      finisherId, attackerRig: ai.rig, defenderRig: di.rig, defenderDeaths: di.deaths, seed,
    });
  }

  /** Build a timeline player without starting it (used by the Combat Lab for scrubbing). */
  createPlayer(attacker: PieceActor, defender: PieceActor, target: THREE.Vector3, opts: CaptureOptions, finalAnchor: 'target' | 'stay' = 'target') {
    const resolved = this.resolve(attacker, defender, opts.finisherId, opts.seed);
    this.lastResolved = resolved;
    const seq = opts.sequence ?? resolved.sequence;
    const info = FactionManager.combatInfo(attacker.faction, attacker.pieceClass);
    return new CombatTimelinePlayer(seq, {
      attacker, defender, target, deathType: opts.deathType ?? resolved.deathType, seed: opts.seed, finalAnchor,
      impactSound: info.impactSound, swingSound: info.swingSound, fireSound: info.fireSound,
    }, {
      fx: this.s.fx, audio: this.s.audio, deaths: this.s.deaths, camera: this.s.camera,
      slowmo: (scale, secs) => this.s.slowmo(scale, secs),
    });
  }

  /** Play a capture fight on the board. Resolves when the attacker stands on the target square. */
  async capture(attacker: PieceActor, defender: PieceActor, target: THREE.Vector3, opts: CaptureOptions): Promise<void> {
    if (opts.speed <= 0) {
      // Fights disabled: snap the capture with a quick death.
      const dir = defender.position.clone().sub(attacker.position);
      void this.s.deaths.kill(defender, 'light_death', dir, opts.seed);
      attacker.position.copy(target);
      attacker.yaw = facingYaw(attacker.color);
      return;
    }
    const player = this.createPlayer(attacker, defender, target, opts);
    this.speed = opts.speed;
    this.s.camera?.autoFrame(attacker.position, defender.position, player.duration * 0.8);
    this.s.setFightFocus(attacker, defender);
    this.current = player;
    await new Promise<void>((resolve) => { player.onDone = resolve; });
    this.current = null;
    this.s.setFightFocus(null, null);
    this.s.camera?.releaseShot();
  }

  /**
   * Checkmate: the board goes still, the camera pushes in (keeping the board
   * readable), the king reacts, the checking piece advances and performs the
   * winner's victory finisher, the king falls, and the camera pulls back.
   */
  async checkmate(attacker: PieceActor, king: PieceActor, finisherId: string, seed: number, speed: number): Promise<void> {
    this.s.freezeOthers([attacker, king], true);
    this.s.audio.play('voice_checkmate');
    this.s.duck(true);
    this.s.camera?.combatShot('push', attacker.position, king.position, 0.9, 2.2);
    king.visual.play('HIT_LIGHT');
    await this.s.wait(0.9 / Math.max(0.5, speed));
    // The finisher comes from the KING slot (the "victory finisher"), whatever piece delivers mate.
    const seq = this.registry.get(`king:${finisherId}`) ?? this.registry.get('king:king_f1')!;
    const player = this.createPlayer(attacker, king, king.position.clone(), { finisherId, seed, speed, sequence: seq, deathType: pickKingDeath(king) }, 'stay');
    this.speed = Math.max(0.5, speed);
    this.current = player;
    await new Promise<void>((resolve) => { player.onDone = resolve; });
    this.current = null;
    attacker.visual.play('VICTORY');
    this.s.camera?.releaseShot();
    await this.s.wait(1.2);
    this.s.freezeOthers([attacker, king], false);
    this.s.duck(false);
  }

  /** Walk / leap a piece to a square (non-capture). */
  async move(actor: PieceActor, toSquare: string, speed: number, opts: { leap?: boolean; quick?: boolean } = {}) {
    const from = actor.position.clone();
    const to = squareToWorld(toSquare);
    const dist = from.distanceTo(to);
    if (speed <= 0 || opts.quick) { actor.position.copy(to); actor.yaw = facingYaw(actor.color); return; }
    const k = 1 / speed;
    actor.busy = true;
    const face = yawToward(from, to);
    const startYaw = actor.yaw;
    const faceTo = startYaw + angleDelta(startYaw, face);
    await this.s.tweens.to(0.14 * k, (u) => { actor.yaw = startYaw + (faceTo - startYaw) * u; }, { ease: 'out' });
    const info = FactionManager.combatInfo(actor.faction, actor.pieceClass);
    if (opts.leap) {
      actor.visual.play('JUMP');
      await this.s.tweens.to(0.75 * k, (u) => { actor.position.lerpVectors(from, to, u); actor.position.y = Math.sin(Math.PI * u) * 0.9; }, { ease: 'inOut' });
      actor.position.y = 0;
      this.s.fx.emit('dust_ring', to, { scale: 0.7 });
      this.s.audio.play(info.moveSound, to, { volume: 1.2 });
    } else {
      actor.visual.setLocomotion(dist > 2.5 ? 'run' : 'move');
      const dur = Math.min(1.5, Math.max(0.45, dist * (dist > 2.5 ? 0.22 : 0.34))) * k;
      let nextStep = 0;
      await this.s.tweens.to(dur, (u) => {
        actor.position.lerpVectors(from, to, u);
        if (u >= nextStep) { nextStep += 0.25; this.s.audio.play(info.moveSound, actor.position, { volume: 0.5 }); this.s.fx.emit('step_dust', actor.position, { scale: 0.6 }); }
      }, { ease: 'inOut' });
      actor.visual.setLocomotion('idle');
    }
    const endYaw = actor.yaw;
    const home = endYaw + angleDelta(endYaw, facingYaw(actor.color));
    await this.s.tweens.to(0.2 * k, (u) => { actor.yaw = endYaw + (home - endYaw) * u; }, { ease: 'out' });
    actor.busy = false;
  }

  skip() { this.current?.skip(); }

  update(dt: number) {
    if (!this.current) return;
    this.current.update(dt * this.speed);
    if (this.current?.done) this.current.onDone?.();
  }
}

function angleDelta(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function pickKingDeath(king: PieceActor): DeathTypeId {
  const info = FactionManager.combatInfo(king.faction, PIECE_KEYS[king.type]);
  return info.deaths[0] ?? 'kneel_and_fall';
}

declare module './CombatTimelineManager' {
  interface CombatTimelinePlayer { onDone?: () => void }
}
