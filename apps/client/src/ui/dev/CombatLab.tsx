// Combat Laboratory — pick attacker/defender class + faction, finisher and
// death type, then preview the interaction on the real board. Pause, step
// frame-by-frame, and scrub the timeline (deterministic re-simulation).

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  CLASS_TO_TYPE, DEATH_TYPES, DEATH_TYPE_IDS, FACTION_IDS, PIECE_CLASSES, finishersFor, type CombatSequence, type DeathTypeId, type FactionId,
  type PieceClass, type Square,
} from '@ashen/shared';
import { useApp } from '../../core/store';
import { squareToWorld } from '../../game/coords';
import type { CombatTimelinePlayer } from '../../game/CombatTimelineManager';
import { FactionManager } from '../../game/FactionManager';
import { GameController } from '../../game/GameController';
import { StageHandle } from '../../scene/GameCanvas';
import { Btn, Panel, Seg } from '../common';
import { TopBar } from '../TopBar';

const FPS = 60;

export interface CombatLabProps {
  embedded?: boolean;
  sequence?: CombatSequence;
  onTime?: (t: number) => void;
  /** Force the attacker/defender (Army Creator preview). */
  force?: { attackerFaction: FactionId; attackerClass: PieceClass; defenderFaction: FactionId; defenderClass: PieceClass; version?: number };
}

export default function CombatLab({ embedded, sequence, onTime, force }: CombatLabProps = {}) {
  const go = useApp((s) => s.go);
  const [atkClassS, setAtkClass] = useState<PieceClass>('knight');
  const [defClassS, setDefClass] = useState<PieceClass>('queen');
  const [atkFactionS, setAtkFaction] = useState<FactionId>('machines');
  const [defFactionS, setDefFaction] = useState<FactionId>('wastelanders');
  const atkClass = force?.attackerClass ?? atkClassS, defClass = force?.defenderClass ?? defClassS;
  const atkFaction = force?.attackerFaction ?? atkFactionS, defFaction = force?.defenderFaction ?? defFactionS;
  const [finisher, setFinisher] = useState('knight_f3');
  const [death, setDeath] = useState<DeathTypeId | 'auto'>('heavy_death');
  const [atkSq, setAtkSq] = useState<Square>('d3');
  const [defSq, setDefSq] = useState<Square>('e5');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [info, setInfo] = useState<{ key: string; chain: string[]; seq: CombatSequence | null }>({ key: '', chain: [], seq: null });
  const player = useRef<CombatTimelinePlayer | null>(null);
  const raf = useRef(0);

  useEffect(() => { const f = finishersFor(atkClass); if (!f.some((x) => x.id === finisher)) setFinisher(f[0].id); }, [atkClass]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Rebuild the scene and the timeline player, then fast-forward to `t` seconds. */
  const setup = (t = 0) => {
    const st = StageHandle.current;
    if (!st) return;
    st.combat.current = null;
    st.deaths.finishAll();
    st.fx.clearTransient();
    st.tweens.finish();
    st.clearPieces();
    st.factions = { w: atkFaction, b: defFaction };
    const a = st.createActor(CLASS_TO_TYPE[atkClass], 'w', atkSq, atkFaction);
    const d = st.createActor(CLASS_TO_TYPE[defClass], 'b', defSq, defFaction);
    // Bystanders keep the board context readable.
    st.createActor('p', 'w', 'c2', atkFaction); st.createActor('p', 'w', 'f2', atkFaction);
    st.createActor('p', 'b', 'd7', defFaction); st.createActor('p', 'b', 'g6', defFaction);
    const p = st.combat.createPlayer(a, d, squareToWorld(defSq), { finisherId: finisher, seed: 7, speed: 1, sequence, deathType: death === 'auto' ? undefined : death });
    st.combat.current = p;
    st.fx.resetSeed(1000);
    const r = st.combat.lastResolved;
    setInfo({ key: sequence ? `(editor) ${sequence.id}` : r?.matchedKey ?? '', chain: r?.chain ?? [], seq: sequence ?? r?.sequence ?? null });
    player.current = p;
    st.paused = true;
    if (t > 0) st.step(t, 1 / FPS);
    setTime(t);
    onTime?.(t);
  };

  useEffect(() => {
    GameController.enterLab();
    const st = StageHandle.current;
    if (st && !embedded) {
      st.camera.setMode('lab');
      const mid = squareToWorld(atkSq).add(squareToWorld(defSq)).multiplyScalar(0.5).setY(0.4);
      st.camera.setTarget(mid);
      st.camera.limits.maxRadius = 14;
    }
    setup(0);
    return () => { cancelAnimationFrame(raf.current); if (st) { st.paused = false; st.combat.current = null; st.camera.limits.maxRadius = 17; } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setup(0); setPlaying(false); }, [atkClass, defClass, atkFaction, defFaction, finisher, death, atkSq, defSq, sequence, force?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Playback loop drives the stage clock ourselves so the slider stays exact.
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const st = StageHandle.current, p = player.current;
      if (!st || !p) return;
      const dt = Math.min(0.05, (now - last) / 1000) * speed;
      last = now;
      st.step(dt, 1 / FPS);
      setTime(p.t);
      onTime?.(p.t);
      if (p.done && st.deaths.active === 0) { setPlaying(false); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  const duration = info.seq ? info.seq.duration + 2.5 : 4;
  const scrub = (t: number) => { setPlaying(false); setup(t); };
  const step = (frames: number) => {
    setPlaying(false);
    const target = Math.max(0, time + frames / FPS);
    if (frames < 0) setup(target);
    else { StageHandle.current?.step(frames / FPS, 1 / FPS); setTime(target); onTime?.(target); }
  };

  const events = useMemo(() => (info.seq?.events ?? []).slice().sort((a, b) => a.t - b.t), [info.seq]);
  const factionOpts = [...FACTION_IDS] as FactionId[];

  const controls = (
    <section className="panel pe-auto" style={{ position: embedded ? 'relative' : 'absolute', bottom: embedded ? undefined : 18, left: embedded ? undefined : '50%', transform: embedded ? undefined : 'translateX(-50%)', width: embedded ? '100%' : 'min(900px, calc(100vw - 40px))' }}>
      <div className="panel-body col" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" title="Restart" onClick={() => scrub(0)}>⏮</button>
          <button className="icon-btn" title="Back 1 frame" onClick={() => step(-1)}>◀|</button>
          <Btn size="small" variant="primary" onClick={() => { if (player.current?.done && StageHandle.current?.deaths.active === 0) setup(0); setPlaying((p) => !p); }}>{playing ? 'Pause' : 'Play'}</Btn>
          <button className="icon-btn" title="Forward 1 frame" onClick={() => step(1)}>|▶</button>
          <button className="icon-btn" title="Forward 10 frames" onClick={() => step(10)}>▶▶</button>
          <input type="range" className="grow" min={0} max={duration} step={1 / FPS} value={Math.min(time, duration)} onChange={(e) => scrub(Number(e.target.value))} />
          <span className="mono" style={{ width: 120, textAlign: 'right' }}>{time.toFixed(2)}s · f{Math.round(time * FPS)}</span>
          <Seg value={speed} onChange={setSpeed} options={[0.1, 0.25, 0.5, 1].map((v) => ({ value: v, label: `${v}×` }))} />
        </div>
        <div style={{ position: 'relative', height: 26, background: 'rgba(0,0,0,0.35)', border: '1px solid var(--line)' }}>
          {events.map((e, i) => (
            <div key={i} title={`${e.t.toFixed(2)}s ${e.type}${'actor' in e ? ` (${e.actor})` : ''}`}
              style={{ position: 'absolute', left: `${(e.t / duration) * 100}%`, top: 3 + (i % 3) * 7, width: 6, height: 6, transform: 'rotate(45deg)', background: EVENT_COLORS[e.type] ?? '#888' }} />
          ))}
          <div style={{ position: 'absolute', left: `${(time / duration) * 100}%`, top: 0, bottom: 0, width: 2, background: 'var(--amber-hi)' }} />
        </div>
      </div>
    </section>
  );

  if (embedded) return controls;

  return (
    <div className="screen pe-none" style={{ animation: 'none' }}>
      <div className="pe-auto"><TopBar back={() => { GameController.startDemo(); go('lobby'); }} title="Combat Laboratory" /></div>
      <div className="pe-auto" style={{ position: 'absolute', left: 18, top: 76, width: 300, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 'calc(100vh - 220px)', overflow: 'auto' }}>
        <Panel title="Attacker">
          <div className="col" style={{ gap: 8 }}>
            <select className="input" value={atkFaction} onChange={(e) => setAtkFaction(e.target.value as FactionId)}>{factionOpts.map((f) => <option key={f} value={f}>{FactionManager.displayName(f)}</option>)}</select>
            <div className="row wrap" style={{ gap: 4 }}>{PIECE_CLASSES.map((p) => <button key={p} className={`btn small ${atkClass === p ? 'primary' : 'ghost'}`} onClick={() => setAtkClass(p)}>{p}</button>)}</div>
            <div className="field"><label>Finisher</label>
              <select className="input" value={finisher} onChange={(e) => setFinisher(e.target.value)}>{finishersFor(atkClass).map((f) => <option key={f.id} value={f.id}>0{f.slot} — {f.name}</option>)}<option value="none">(none → fallback chain)</option></select></div>
            <div className="field"><label>Square</label><input className="input mono" value={atkSq} onChange={(e) => /^[a-h][1-8]$/.test(e.target.value) && setAtkSq(e.target.value as Square)} /></div>
          </div>
        </Panel>
        <Panel title="Defender">
          <div className="col" style={{ gap: 8 }}>
            <select className="input" value={defFaction} onChange={(e) => setDefFaction(e.target.value as FactionId)}>{factionOpts.map((f) => <option key={f} value={f}>{FactionManager.displayName(f)}</option>)}</select>
            <div className="row wrap" style={{ gap: 4 }}>{PIECE_CLASSES.map((p) => <button key={p} className={`btn small ${defClass === p ? 'primary' : 'ghost'}`} onClick={() => setDefClass(p)}>{p}</button>)}</div>
            <div className="field"><label>Death</label>
              <select className="input" value={death} onChange={(e) => setDeath(e.target.value as DeathTypeId)}><option value="auto">auto (resolver)</option>{DEATH_TYPE_IDS.map((d) => <option key={d} value={d}>{DEATH_TYPES[d].label}</option>)}</select></div>
            <div className="field"><label>Square</label><input className="input mono" value={defSq} onChange={(e) => /^[a-h][1-8]$/.test(e.target.value) && setDefSq(e.target.value as Square)} /></div>
          </div>
        </Panel>
      </div>
      <div className="pe-auto" style={{ position: 'absolute', right: 18, top: 76, width: 320, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 'calc(100vh - 220px)' }}>
        <Panel title="Resolution">
          <div className="col" style={{ gap: 3, fontSize: 12 }} >
            {info.chain.map((k) => <div key={k} className="mono" style={{ color: k === info.key ? 'var(--amber-hi)' : 'var(--text-faint)' }}>{k === info.key ? '▶ ' : '  '}{k}</div>)}
            {info.key.startsWith('(editor)') && <div className="mono amber">{info.key}</div>}
          </div>
        </Panel>
        <Panel title={info.seq?.name ?? 'Timeline'} right={<span className="chip">{info.seq?.duration.toFixed(1)}s</span>} style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }} bodyClass="scroll grow">
          {events.map((e, i) => (
            <div key={i} className="row mono" style={{ fontSize: 11.5, gap: 8, padding: '2px 0', color: e.t <= time ? 'var(--text)' : 'var(--text-faint)' }}>
              <span style={{ width: 40 }}>{e.t.toFixed(2)}</span>
              <span style={{ width: 8, height: 8, transform: 'rotate(45deg)', background: EVENT_COLORS[e.type] }} />
              <span className="truncate">{describe(e)}</span>
            </div>
          ))}
        </Panel>
      </div>
      {controls}
    </div>
  );
}

export const EVENT_COLORS: Record<string, string> = {
  anim: '#e8a23a', move: '#7fc06a', face: '#9a8f7a', rotate: '#9a8f7a', impact: '#ff4a2a', fx: '#39d0ff', sound: '#b56bff',
  shake: '#ff9a4a', death: '#ff2a1c', hide: '#666', camera: '#ffffff', slowmo: '#6fe0ff', pause_anim: '#888',
};

export function describe(e: CombatSequence['events'][number]): string {
  switch (e.type) {
    case 'anim': return `${e.actor} plays ${e.action}${e.speed ? ` ×${e.speed}` : ''}`;
    case 'move': return `${e.actor} → ${e.to} (${e.duration}s${e.arc ? `, arc ${e.arc}` : ''})`;
    case 'face': return `${e.actor} faces ${e.toward}`;
    case 'rotate': return `${e.actor} rotates ${e.yaw}°`;
    case 'impact': return `IMPACT ${e.strength}${e.fx ? ` · ${e.fx}` : ''}${e.hit ? ` · ${e.hit}` : ''}`;
    case 'fx': return `fx ${e.fx} @ ${e.at}`;
    case 'sound': return `sound ${e.sound}`;
    case 'shake': return `shake ${e.strength}`;
    case 'death': return `defender dies (${e.deathType ?? 'auto'})`;
    case 'hide': return `hide ${e.actor}`;
    case 'camera': return `camera ${e.shot}`;
    case 'slowmo': return `slow-mo ${e.scale}× for ${e.duration}s`;
    case 'pause_anim': return `pause ${e.actor} ${e.duration}s`;
  }
}

void THREE;
