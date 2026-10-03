// CombatTimelineManager — executes a serialized CombatSequence against two
// real PieceActors standing on the real board. Anchors are resolved from
// board positions (strike point, flanks, the capture square...), so the same
// data works for every piece, faction and uploaded model. The player is fully
// deterministic in its own clock, which lets editors scrub it.

import * as THREE from 'three';
import { type Anchor, type CombatSequence, type DeathTypeId, type TimelineEvent } from '@ashen/shared';
import type { AudioPlayer } from './audioBridge';
import type { CameraDirector } from './CameraDirector';
import { facingYaw, shortestAngle, yawToward } from './coords';
import type { DeathAnimationManager } from './DeathAnimationManager';
import type { FxSystem } from './FxSystem';
import type { PieceActor } from './PieceActor';
import { TweenRunner } from './tween';

export interface TimelineServices {
  fx: FxSystem;
  audio: AudioPlayer;
  deaths: DeathAnimationManager;
  camera: CameraDirector | null;
  /** Requests a global slow-motion window. */
  slowmo(scale: number, seconds: number): void;
}

export interface TimelineSetup {
  attacker: PieceActor;
  defender: PieceActor;
  /** World position of the capture square (the attacker's final square). */
  target: THREE.Vector3;
  deathType: DeathTypeId;
  seed: number;
  /** Where the attacker ends: on the captured square (captures) or where it struck (checkmate). */
  finalAnchor: 'target' | 'stay';
  /** Impact sound fallback for this attacker. */
  impactSound: string;
  swingSound: string;
  /** Set for gun/energy weapons: every generic impact is preceded by the weapon firing. */
  fireSound?: string;
}

export class CombatTimelinePlayer {
  t = 0;
  private i = 0;
  private events: TimelineEvent[];
  private tweens = new TweenRunner();
  private dir: THREE.Vector3;
  private perp: THREE.Vector3;
  private origin: THREE.Vector3;
  private defenderStart: THREE.Vector3;
  private deathStarted = false;
  private deathPromise: Promise<void> | null = null;
  done = false;
  readonly duration: number;

  constructor(private seq: CombatSequence, private s: TimelineSetup, private svc: TimelineServices) {
    this.events = [...seq.events].sort((a, b) => a.t - b.t);
    if (s.finalAnchor === 'stay') this.events = this.events.filter((e) => !(e.type === 'move' && e.actor === 'attacker' && e.to === 'target'));
    this.duration = seq.duration;
    this.origin = s.attacker.position.clone();
    this.defenderStart = s.defender.position.clone();
    this.dir = this.defenderStart.clone().sub(this.origin).setY(0);
    if (this.dir.lengthSq() < 1e-4) this.dir.set(0, 0, -1);
    this.dir.normalize();
    this.perp = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    s.attacker.busy = true;
    s.defender.busy = true;
  }

  anchor(a: Anchor, actor: PieceActor): THREE.Vector3 {
    const d = this.defenderStart;
    const reach = 0.62;
    switch (a) {
      case 'origin': return this.origin.clone();
      case 'target': return this.s.target.clone();
      case 'strike': return d.clone().addScaledVector(this.dir, -reach);
      case 'close': return d.clone().addScaledVector(this.dir, -0.4);
      case 'behind_target': return d.clone().addScaledVector(this.dir, 0.8);
      case 'retreat': return d.clone().addScaledVector(this.dir, -reach - 0.35);
      case 'flank_left': return d.clone().addScaledVector(this.perp, 0.62).addScaledVector(this.dir, -0.12);
      case 'flank_right': return d.clone().addScaledVector(this.perp, -0.62).addScaledVector(this.dir, -0.12);
      case 'pushed': return d.clone().addScaledVector(this.dir, 0.25);
      case 'home': return actor === this.s.attacker ? this.origin.clone() : this.defenderStart.clone();
    }
  }

  private actor(which: 'attacker' | 'defender') { return which === 'attacker' ? this.s.attacker : this.s.defender; }

  private faceTween(actor: PieceActor, yaw: number, dur: number) {
    const from = actor.yaw;
    const to = shortestAngle(from, yaw);
    if (dur <= 0) { actor.yaw = to; return; }
    void this.tweens.to(dur, (u) => { actor.yaw = from + (to - from) * u; }, { ease: 'out' });
  }

  private fire(e: TimelineEvent) {
    const { fx, audio } = this.svc;
    switch (e.type) {
      case 'anim': {
        const a = this.actor(e.actor);
        if (!a.alive && e.actor === 'defender') return;
        a.visual.play(e.action, { speed: e.speed, loop: e.loop });
        if (e.actor === 'attacker' && e.action.startsWith('ATTACK')) audio.play(this.s.swingSound, a.position);
        break;
      }
      case 'pause_anim': {
        const a = this.actor(e.actor);
        a.visual.setPaused(true);
        void this.tweens.to(e.duration, () => {}).then(() => a.visual.setPaused(false));
        break;
      }
      case 'move': {
        const a = this.actor(e.actor);
        if (!a.alive && e.actor === 'defender') return;
        const from = a.position.clone();
        const to = this.anchor(e.to, a);
        const dist = from.distanceTo(to);
        if (e.action) a.visual.play(e.action);
        const autoFace = dist > 0.35 && e.to !== 'retreat' && e.to !== 'pushed';
        if (autoFace) this.faceTween(a, yawToward(from, to), Math.min(0.18, e.duration * 0.4));
        const arc = e.arc ?? 0;
        void this.tweens.to(e.duration, (u) => {
          a.position.lerpVectors(from, to, u);
          a.position.y = from.y + Math.sin(Math.PI * u) * arc * 0.5;
        }, { ease: e.ease ?? 'inOut' }).then(() => {
          a.position.y = 0;
          if (e.action === 'MOVE' || e.action === 'RUN') a.visual.setLocomotion('idle');
          if (arc > 0.2) fx.emit('dust_ring', to, { scale: 0.6, seed: this.s.seed + 3 });
          if (e.actor === 'attacker' && e.to === 'target') this.faceTween(a, facingYaw(a.color), 0.3);
        });
        break;
      }
      case 'face': {
        const a = this.actor(e.actor);
        if (!a.alive && e.actor === 'defender') return;
        const other = this.actor(e.actor === 'attacker' ? 'defender' : 'attacker');
        const yaw = e.toward === 'other' ? yawToward(a.position, other.position) : e.toward === 'origin' ? yawToward(a.position, this.origin) : facingYaw(a.color);
        this.faceTween(a, yaw, e.duration ?? 0.2);
        break;
      }
      case 'rotate': {
        const a = this.actor(e.actor);
        const from = a.yaw, delta = (e.yaw * Math.PI) / 180;
        void this.tweens.to(e.duration, (u) => { a.yaw = from + delta * u; }, { ease: 'inOut' });
        break;
      }
      case 'impact': {
        const d = this.s.defender;
        const at = d.chest();
        const strength = { light: 0.5, medium: 0.8, heavy: 1.1, massive: 1.5 }[e.strength];
        if (e.fx) fx.emit(e.fx, at, { dir: this.dir, scale: strength, seed: this.s.seed + Math.round(e.t * 100) });
        // Weapon-true audio: generic cues (none, gunshot, hit_*) become this attacker's
        // own shot + impact; bespoke cues (block, execution, crash…) play as authored.
        const generic = !e.sound || e.sound === 'gunshot' || e.sound === 'energy_shot' || e.sound.startsWith('hit_');
        if (generic && this.s.fireSound) audio.play(this.s.fireSound, this.s.attacker.position, { volume: 0.9 });
        audio.play(generic ? this.s.impactSound : e.sound!, at, { volume: 0.7 + strength * 0.3 });
        if (d.alive || !this.deathStarted) {
          if (e.hit) d.visual.play(e.hit);
          if (e.knock) {
            const from = d.position.clone();
            const to = from.clone().addScaledVector(this.dir, e.knock * 0.35);
            void this.tweens.to(0.18, (u) => d.position.lerpVectors(from, to, u), { ease: 'out' });
          }
        }
        if (strength >= 1.1) this.svc.slowmo(0.25, 0.07); // hit-stop
        this.svc.camera?.addShake(strength * 0.35, 0.18);
        break;
      }
      case 'fx': {
        const pos = e.at === 'attacker' ? this.s.attacker.chest() : e.at === 'defender' ? this.s.defender.chest() : e.at === 'target' ? this.s.target.clone().setY(0.3)
          : this.s.attacker.chest().lerp(this.s.defender.chest(), 0.5);
        const dir = e.at === 'attacker' ? new THREE.Vector3(Math.sin(this.s.attacker.yaw), 0, Math.cos(this.s.attacker.yaw)) : this.dir;
        const muzzle = e.fx === 'muzzle_flash' ? pos.addScaledVector(dir, 0.3) : pos;
        fx.emit(e.fx, muzzle, { dir, scale: e.scale ?? 1, seed: this.s.seed + Math.round(e.t * 100) + 17 });
        break;
      }
      case 'sound': {
        const pos = e.at === 'defender' ? this.s.defender.position : e.at === 'target' ? this.s.target : this.s.attacker.position;
        audio.play(e.sound, pos, { volume: e.volume });
        break;
      }
      case 'shake': this.svc.camera?.addShake(e.strength, e.duration); break;
      case 'death': {
        if (this.deathStarted) return;
        this.deathStarted = true;
        const type = !e.deathType || e.deathType === 'auto' ? this.s.deathType : e.deathType;
        this.deathPromise = this.svc.deaths.kill(this.s.defender, type, this.dir, this.s.seed);
        break;
      }
      case 'hide': this.actor(e.actor).root.visible = false; break;
      case 'camera': {
        const cam = this.svc.camera;
        if (!cam) return;
        if (e.shot === 'return') cam.releaseShot();
        else cam.combatShot(e.shot, this.s.attacker.position, this.s.defender.position, e.strength ?? 0.6, e.duration ?? 1.5);
        break;
      }
      case 'slowmo': this.svc.slowmo(e.scale, e.duration); break;
    }
  }

  update(dt: number) {
    if (this.done) return;
    this.t += dt;
    while (this.i < this.events.length && this.events[this.i].t <= this.t) this.fire(this.events[this.i++]);
    this.tweens.update(dt);
    if (this.t >= this.duration && this.i >= this.events.length && this.tweens.active === 0) this.finish();
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    const a = this.s.attacker;
    if (this.s.finalAnchor === 'target') { a.position.copy(this.s.target); a.yaw = facingYaw(a.color); }
    a.position.y = 0;
    a.visual.setLocomotion('idle');
    a.busy = false;
  }

  /** Fast-forward to the end (skip). Death keeps running independently. */
  skip() {
    let guard = 0;
    while (!this.done && guard++ < 2000) this.update(1 / 30);
    this.tweens.finish();
    this.finish();
  }

  get death() { return this.deathPromise; }
  get progress() { return Math.min(1, this.t / this.duration); }
}
