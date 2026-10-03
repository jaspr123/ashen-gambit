// Wasteland Derby race simulation. Deterministic for a given seed + field +
// upgrades, so the server computes a race once and every client replays the
// identical timeline. The same function (without upgrades, many seeds) prices
// the odds — purchased upgrades are the hidden edge the odds do not know about.

import {
  DERBY_WEAPONS, RACE_DISTANCE, TRACK, TRACK_LAP,
  type DerbyBetKind, type DerbyEvent, type DerbyHorseDef, type DerbyTimeline, type DerbyUpgradeId,
} from './data.js';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the start gate sits on the lap (the finish post is RACE_DISTANCE further on). */
export const START_S = TRACK.startAt;

/** True when lap position `p` is on one of the two bends. */
export function inBend(p: number) {
  const q = ((p % TRACK_LAP) + TRACK_LAP) % TRACK_LAP;
  const bend = Math.PI * TRACK.radius;
  return (q >= TRACK.straight && q < TRACK.straight + bend) || q >= 2 * TRACK.straight + bend;
}

export interface SimEntry { id: string; lane: number; def: DerbyHorseDef; upgrades?: DerbyUpgradeId[] }

interface R {
  id: string; def: DerbyHorseDef; up: Set<DerbyUpgradeId>;
  s: number; lat: number; v: number; hp: number; maxHp: number; stamina: number; form: number; drift: number; rank: number;
  cd: number; stag: number; slow: number; burn: number; boost: number; smoke: number; smokeCd: number; down: number;
  usedNitro: boolean; usedGrapple: boolean; usedMedic: boolean;
  finished: number | null;
}

const FLAG = { stag: 1, boost: 2, smoke: 4, down: 8 };

/**
 * Run a race. `record` produces the full replay timeline (server, at the off);
 * without it only the finishing order is computed (odds pricing).
 */
export function simulateRace(raceId: string, seed: number, entries: SimEntry[], opts: { record?: boolean; dt?: number } = {}): DerbyTimeline {
  const rnd = mulberry32(seed);
  const dt = opts.dt ?? 0.05;
  const record = opts.record ?? false;
  const recordEvery = Math.max(1, Math.round(0.2 / dt));
  const D = RACE_DISTANCE;
  const rs: R[] = entries.map((e) => {
    const maxHp = 80 + e.def.stats.grit * 6;
    return {
      id: e.id, def: e.def, up: new Set(e.upgrades ?? []),
      s: 0, lat: 0.5 + e.lane * TRACK.laneWidth, v: 0, hp: maxHp, maxHp, stamina: 100,
      // Race-day form: how this horse feels today. Big enough that favourites lose.
      form: 1 + (rnd() - 0.5) * 0.11, drift: 0, rank: 0,
      cd: 2 + rnd() * 3, stag: 0, slow: 0, burn: 0, boost: 0, smoke: 0, smokeCd: 0, down: 0,
      usedNitro: false, usedGrapple: false, usedMedic: false, finished: null,
    };
  });
  const events: DerbyEvent[] = [];
  const frames: number[][] = [];
  const finishOrder: string[] = [];
  const finishTimes: Record<string, number> = {};
  const ev = (e: DerbyEvent) => { if (record) events.push({ ...e, t: Math.round(e.t * 100) / 100 }); };
  let leader: string | null = null;
  let lastLeadT = -10;
  let t = 0;
  let tick = 0;
  let allDoneAt: number | null = null;

  const place = (r: R) => r.rank;

  const damage = (att: R | null, tgt: R, amount: number, effect: string | null, weapon?: string) => {
    let dmg = amount * (tgt.up.has('plated_barding') ? 0.66 : 1);
    dmg = Math.round(dmg);
    tgt.hp -= dmg;
    const stagMul = tgt.up.has('spiked_shoes') ? 0.6 : 1;
    if (effect === 'stagger') tgt.stag = Math.max(tgt.stag, 1.0 * stagMul);
    else if (effect === 'knock') { tgt.stag = Math.max(tgt.stag, 0.6 * stagMul); tgt.lat = Math.min(0.5 + (TRACK.lanes + 1) * TRACK.laneWidth, tgt.lat + 0.9); }
    else if (effect === 'slow') tgt.slow = Math.max(tgt.slow, 2.5);
    else if (effect === 'burn') tgt.burn = Math.max(tgt.burn, 3);
    if (att) ev({ t, kind: 'hit', runner: att.id, target: tgt.id, damage: dmg, weapon: weapon as never });
    if (tgt.hp <= 0 && tgt.down <= 0) {
      tgt.hp = 0; tgt.down = 3.2; tgt.stag = 0; tgt.boost = 0;
      ev({ t, kind: 'wipeout', runner: tgt.id, target: att?.id });
    } else if (!tgt.usedMedic && tgt.up.has('field_medic') && tgt.hp < tgt.maxHp * 0.35) {
      tgt.usedMedic = true; tgt.hp = Math.min(tgt.maxHp, tgt.hp + tgt.maxHp * 0.35);
      ev({ t, kind: 'heal', runner: tgt.id, upgrade: 'field_medic' });
    }
    if (tgt.up.has('smoke_bombs') && tgt.smokeCd <= 0 && tgt.down <= 0) {
      tgt.smoke = 3; tgt.smokeCd = 9;
      ev({ t, kind: 'smoke', runner: tgt.id, upgrade: 'smoke_bombs' });
    }
  };

  while (t < 140) {
    // Order by progress for blocking / leader checks.
    const order = [...rs].sort((a, b) => (a.finished ?? Infinity) - (b.finished ?? Infinity) || b.s - a.s);
    order.forEach((r, i) => { r.rank = i + 1; });
    const running = order.filter((r) => r.finished === null);
    if (running.length && running[0].id !== leader && t - lastLeadT > 1.5 && running[0].s > D * 0.04) {
      leader = running[0].id; lastLeadT = t;
      ev({ t, kind: 'lead', runner: leader });
    }
    for (const r of rs) {
      const st = r.def.stats;
      const f = r.s / D;
      const base = (5.75 + st.speed * 0.085) * r.form * (1 + r.drift);
      // ---- target speed
      let target: number;
      if (r.finished !== null) target = 2.2;
      else if (r.down > 0) target = 0;
      else {
        const phase = f < 0.2 ? 0.95 + st.aggression * 0.004 : f < 0.72 ? 0.93 + (st.stamina - 5) * 0.004 : 1.03 + (r.stamina / 100) * 0.05;
        const tired = r.stamina < 30 ? 0.85 + 0.15 * (r.stamina / 30) : 1;
        const hurt = 0.86 + 0.14 * Math.min(1, r.hp / (r.maxHp * 0.5));
        target = base * phase * tired * hurt;
        if (r.stag > 0) target *= 0.68;
        if (r.slow > 0) target *= 0.86;
        if (r.boost > 0) target *= 1.24;
        // Blocked by a runner directly ahead on the same line?
        for (const o of rs) {
          if (o === r || o.finished !== null) continue;
          const dx = o.s - r.s;
          if (dx > 0 && dx < 1.3 && Math.abs(o.lat - r.lat) < 0.7) { target = Math.min(target, o.v + 0.1); break; }
        }
      }
      const acc = r.down > 0 ? 6 : 2.6;
      r.v += Math.max(-acc * dt, Math.min(acc * dt, target - r.v));
      // Running wide on a bend costs ground. The visual track is compact, so the
      // penalty uses a racecourse-scale radius instead of the literal one.
      const bendRate = inBend(START_S + r.s) ? 1 / (1 + r.lat / (TRACK.radius * 4)) : 1;
      r.s += r.v * dt * bendRate;

      // ---- stamina
      if (r.finished === null && r.down <= 0) {
        const effort = Math.pow(r.v / base, 3);
        const drain = effort * (2.6 - st.stamina * 0.14) * (r.up.has('iron_lungs') ? 0.7 : 1);
        r.stamina = Math.max(0, r.stamina - drain * dt * 1.05);
      }

      // ---- lateral: drift to the rail, swing wide to pass a blocker
      if (r.down <= 0) {
        let want = 0.5;
        for (const o of rs) {
          if (o === r) continue;
          const dx = o.s - r.s;
          if (dx > -0.6 && dx < 1.6 && Math.abs(o.lat - want) < 0.75) want = Math.max(want, o.lat + 0.9);
        }
        want = Math.min(want, 0.5 + (TRACK.lanes - 0.5) * TRACK.laneWidth);
        const dl = want - r.lat;
        r.lat += Math.max(-0.7 * dt, Math.min(0.7 * dt, dl));
      }

      // ---- pace wanders (persistent, so it does not average out)
      r.drift = Math.max(-0.05, Math.min(0.05, r.drift * (1 - 0.35 * dt) + (rnd() - 0.5) * 0.06 * Math.sqrt(dt)));

      // ---- timers
      r.cd -= dt; r.stag = Math.max(0, r.stag - dt); r.slow = Math.max(0, r.slow - dt); r.boost = Math.max(0, r.boost - dt);
      r.smoke = Math.max(0, r.smoke - dt); r.smokeCd = Math.max(0, r.smokeCd - dt);
      if (r.burn > 0) { r.burn -= dt; r.hp -= 2.2 * dt; if (r.hp <= 0 && r.down <= 0) damage(null, r, 0, null); }
      if (r.down > 0) {
        r.down -= dt;
        if (r.down <= 0) { r.hp = Math.round(r.maxHp * 0.35); r.stag = 0.5; ev({ t, kind: 'remount', runner: r.id }); }
      }
      if (r.finished !== null || r.down > 0) continue;

      // ---- random stumble
      if (rnd() < (r.up.has('spiked_shoes') ? 0.002 : 0.0045) * dt) { r.stag = Math.max(r.stag, 0.8); ev({ t, kind: 'stumble', runner: r.id }); }

      // ---- secret upgrades that fire on their own
      const pos = place(r);
      if (!r.usedNitro && r.up.has('nitro_oats') && f > 0.7 && pos > 1) { r.usedNitro = true; r.boost = 3; ev({ t, kind: 'boost', runner: r.id, upgrade: 'nitro_oats' }); }
      if (!r.usedGrapple && r.up.has('grapple_hook') && f > 0.8) {
        const ahead = rs.filter((o) => o !== r && o.finished === null && o.s > r.s && o.s - r.s < 5).sort((a, b) => a.s - b.s)[0];
        if (ahead) {
          r.usedGrapple = true; r.boost = Math.max(r.boost, 1.6); ahead.slow = Math.max(ahead.slow, 1.8);
          ev({ t, kind: 'grapple', runner: r.id, target: ahead.id, upgrade: 'grapple_hook' });
        }
      }

      // ---- jockey attacks
      if (r.cd <= 0 && f > 0.03 && f < 0.995) {
        const w = DERBY_WEAPONS[r.def.weapon];
        const range = w.range + (r.up.has('scattergun') ? 0.6 : 0);
        let best: R | null = null;
        let bestScore = Infinity;
        for (const o of rs) {
          if (o === r || o.finished !== null || o.down > 0) continue;
          const dx = o.s - r.s, dy = o.lat - r.lat;
          if (!w.ranged && (Math.abs(dx) > range || Math.abs(dy) > 1.7)) continue;
          const d = Math.hypot(dx, dy);
          if (d > range) continue;
          const score = d - (dx > 0 ? 1.5 : 0) - (place(o) < pos ? 1 : 0);
          if (score < bestScore) { bestScore = score; best = o; }
        }
        if (best && rnd() < 0.08 + st.aggression * 0.03) {
          r.cd = w.cooldown * (0.85 + rnd() * 0.3);
          ev({ t, kind: 'attack', runner: r.id, target: best.id, weapon: w.id });
          let hit = w.accuracy + st.accuracy * 0.025;
          if (best.smoke > 0) hit *= 0.35;
          if (best.up.has('trick_rider') && rnd() < 0.25) ev({ t, kind: 'dodge', runner: best.id, target: r.id, upgrade: 'trick_rider' });
          else if (rnd() < hit) {
            damage(r, best, w.damage * (r.up.has('scattergun') ? 1.4 : 1) * (0.8 + rnd() * 0.4), w.effect, w.id);
            if (!w.ranged && best.up.has('spiked_shoes') && rnd() < 0.5) { ev({ t, kind: 'counter', runner: best.id, target: r.id, upgrade: 'spiked_shoes' }); damage(null, r, 7, 'stagger'); }
          } else ev({ t, kind: 'miss', runner: r.id, target: best.id, weapon: w.id });
        } else if (best) r.cd = 0.4;
      }
    }

    // ---- finishes (interpolated within the tick)
    let crossed: R[] | null = null;
    for (const r of rs) {
      if (r.finished === null && r.s >= D) {
        const over = (r.s - D) / Math.max(0.01, r.v);
        r.finished = t + dt - over;
        finishTimes[r.id] = Math.round(r.finished * 1000) / 1000;
        (crossed ??= []).push(r);
      }
    }
    if (crossed) for (const r of crossed.sort((a, b) => a.finished! - b.finished!)) { finishOrder.push(r.id); ev({ t: r.finished!, kind: 'finish', runner: r.id, place: finishOrder.length }); }

    if (record && tick % recordEvery === 0) {
      const fr: number[] = [];
      for (const r of rs) {
        const flags = (r.stag > 0 ? FLAG.stag : 0) | (r.boost > 0 ? FLAG.boost : 0) | (r.smoke > 0 ? FLAG.smoke : 0) | (r.down > 0 ? FLAG.down : 0);
        fr.push(Math.round(r.s * 100) / 100, Math.round(r.lat * 100) / 100, Math.max(0, Math.round((r.hp / r.maxHp) * 100)), flags);
      }
      frames.push(fr);
    }
    t += dt; tick++;
    if (finishOrder.length === rs.length) {
      if (allDoneAt === null) allDoneAt = t;
      if (!record || t - allDoneAt > 2.5) break;
    }
  }
  // Anyone still out (pathological): order by distance.
  for (const r of [...rs].sort((a, b) => b.s - a.s)) if (!finishOrder.includes(r.id)) { finishOrder.push(r.id); finishTimes[r.id] = t; }

  return { raceId, step: dt * recordEvery, duration: Math.round(t * 100) / 100, runners: rs.map((r) => r.id), frames, events, finishOrder, finishTimes };
}

export type OddsBook = Record<string, Record<DerbyBetKind, number>>;

/** Monte-Carlo the field (no upgrades) to price fixed odds for each bet kind. */
export function priceRace(seed: number, entries: SimEntry[], sims = 160): OddsBook {
  const pricer = racePricer(seed, entries);
  pricer.run(sims);
  return pricer.book();
}

/** Incremental pricer so a server can spread the Monte-Carlo over several event-loop turns. */
export function racePricer(seed: number, entries: SimEntry[]) {
  const counts: Record<string, [number, number, number]> = Object.fromEntries(entries.map((e) => [e.id, [0, 0, 0]]));
  const plain = entries.map((e) => ({ ...e, upgrades: [] }));
  let done = 0;
  return {
    get done() { return done; },
    run(n: number) {
      for (let k = 0; k < n; k++, done++) {
        const { finishOrder } = simulateRace('odds', (seed ^ Math.imul(done + 1, 2654435761)) >>> 0, plain, { dt: 0.2 });
        finishOrder.forEach((id, i) => { const c = counts[id]; if (i < 1) c[0]++; if (i < 2) c[1]++; if (i < 3) c[2]++; });
      }
    },
    book: () => oddsFromCounts(counts, Math.max(1, done), entries.length),
  };
}

function oddsFromCounts(counts: Record<string, [number, number, number]>, sims: number, n: number): OddsBook {
  const price = (hits: number, places: number, margin: number) => {
    const p = (hits + 0.6) / (sims + (0.6 * n) / places);
    return niceOdds(Math.max(1.05, Math.min(66, 1 / (p * margin))));
  };
  return Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, { win: price(c[0], 1, 1.18), place: price(c[1], 2, 1.14), show: price(c[2], 3, 1.1) }]));
}

/** Round decimal odds to the kind of numbers a bookmaker would post. */
export function niceOdds(x: number) {
  if (x < 2) return Math.round(x * 20) / 20;
  if (x < 5) return Math.round(x * 10) / 10;
  if (x < 12) return Math.round(x * 2) / 2;
  return Math.round(x);
}
