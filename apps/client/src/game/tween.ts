// Minimal deterministic tween runner, advanced by the stage clock (so slow-mo,
// pause and timeline scrubbing affect everything consistently).
import type { Ease } from '@ashen/shared';

export const EASE: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  snap: (t) => (t < 0.85 ? EASE.in(t / 0.85) * 1.04 : 1.04 - 0.04 * ((t - 0.85) / 0.15)),
};

interface Tween { t: number; dur: number; ease: (t: number) => number; step: (u: number) => void; done: () => void; tag?: string }

export class TweenRunner {
  private list: Tween[] = [];

  to(dur: number, step: (u: number) => void, opts: { ease?: Ease; tag?: string } = {}): Promise<void> {
    return new Promise((resolve) => {
      if (dur <= 0) { step(1); resolve(); return; }
      this.list.push({ t: 0, dur, ease: EASE[opts.ease ?? 'inOut'], step, done: resolve, tag: opts.tag });
    });
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      const u = Math.min(1, tw.t / tw.dur);
      tw.step(tw.ease(u));
      if (u >= 1) { this.list.splice(i, 1); tw.done(); }
    }
  }

  /** Finish (snap to end) all tweens with a tag, or all of them. */
  finish(tag?: string) {
    const hit = this.list.filter((t) => !tag || t.tag === tag);
    this.list = this.list.filter((t) => !hit.includes(t));
    for (const t of hit) { t.step(1); t.done(); }
  }

  cancel(tag?: string) { this.list = this.list.filter((t) => tag && t.tag !== tag); }
  get active() { return this.list.length; }
}

export const wait = (runner: TweenRunner, seconds: number) => runner.to(seconds, () => {});
