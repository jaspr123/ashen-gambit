// KillSequenceEditor — no-code visual timeline for custom capture fights.
// Three tracks (attacker / defender / world). Drag events to re-time them,
// click to edit their properties, add events at the playhead. The sequence is
// plain data (CombatSequence) validated by the shared schema.

import { useRef, useState } from 'react';
import {
  ANCHORS, CombatSequenceSchema, DEATH_TYPE_IDS, EASES, FX_IDS, GAME_ACTIONS, type CombatSequence, type TimelineEvent, type TimelineEventType,
} from '@ashen/shared';
import { Btn } from '../common';
import { EVENT_COLORS, describe } from '../dev/CombatLab';

const TRACKS: { id: 'attacker' | 'defender' | 'world'; label: string }[] = [
  { id: 'attacker', label: 'Attacker' }, { id: 'defender', label: 'Defender' }, { id: 'world', label: 'World / FX' },
];

function trackOf(e: TimelineEvent): 'attacker' | 'defender' | 'world' {
  if ('actor' in e) return e.actor;
  return 'world';
}

const TEMPLATES: Record<TimelineEventType, (t: number) => TimelineEvent> = {
  anim: (t) => ({ t, type: 'anim', actor: 'attacker', action: 'ATTACK_PRIMARY' }),
  pause_anim: (t) => ({ t, type: 'pause_anim', actor: 'attacker', duration: 0.2 }),
  move: (t) => ({ t, type: 'move', actor: 'attacker', to: 'strike', duration: 0.4, ease: 'inOut', action: 'RUN' }),
  face: (t) => ({ t, type: 'face', actor: 'attacker', toward: 'other', duration: 0.2 }),
  rotate: (t) => ({ t, type: 'rotate', actor: 'attacker', yaw: 360, duration: 0.4 }),
  impact: (t) => ({ t, type: 'impact', strength: 'heavy', fx: 'spark', hit: 'HIT_HEAVY', knock: 0.3 }),
  fx: (t) => ({ t, type: 'fx', fx: 'spark', at: 'defender' }),
  sound: (t) => ({ t, type: 'sound', sound: 'hit_metal', at: 'defender' }),
  shake: (t) => ({ t, type: 'shake', strength: 0.4, duration: 0.3 }),
  death: (t) => ({ t, type: 'death', deathType: 'auto' }),
  hide: (t) => ({ t, type: 'hide', actor: 'defender' }),
  camera: (t) => ({ t, type: 'camera', shot: 'push', strength: 0.6, duration: 1.5 }),
  slowmo: (t) => ({ t, type: 'slowmo', scale: 0.3, duration: 0.3 }),
};

export function KillSequenceEditor({ sequence, onChange, playhead }: { sequence: CombatSequence; onChange: (s: CombatSequence) => void; playhead: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const lane = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; startX: number; startT: number } | null>(null);
  const events = sequence.events;
  const D = Math.max(sequence.duration, 0.5);
  const valid = CombatSequenceSchema.safeParse(sequence);

  const update = (i: number, patch: Partial<TimelineEvent>) => {
    const next = events.map((e, j) => (j === i ? ({ ...e, ...patch } as TimelineEvent) : e));
    onChange({ ...sequence, events: next });
  };
  const remove = (i: number) => { onChange({ ...sequence, events: events.filter((_, j) => j !== i) }); setSel(null); };
  const add = (type: TimelineEventType) => {
    const ev = TEMPLATES[type](Math.round(Math.min(playhead, D) * 20) / 20);
    onChange({ ...sequence, events: [...events, ev] });
    setSel(events.length);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !lane.current) return;
    const w = lane.current.getBoundingClientRect().width;
    const t = Math.max(0, Math.min(D, d.startT + ((e.clientX - d.startX) / w) * D));
    update(d.index, { t: Math.round(t * 20) / 20 });
  };

  const selected = sel !== null ? events[sel] : null;

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" style={{ width: 220 }} value={sequence.name} onChange={(e) => onChange({ ...sequence, name: e.target.value })} />
        <label className="row dim" style={{ gap: 6 }}>Duration
          <input className="input mono" type="number" step={0.1} min={0.5} max={8} style={{ width: 80 }} value={sequence.duration} onChange={(e) => onChange({ ...sequence, duration: Number(e.target.value) })} />s</label>
        <div className="grow" />
        <select className="input" value="" onChange={(e) => e.target.value && add(e.target.value as TimelineEventType)}>
          <option value="">+ Add event at playhead…</option>
          {(Object.keys(TEMPLATES) as TimelineEventType[]).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {!valid.success && <span className="chip red" title={valid.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('\n')}>invalid</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 0, userSelect: 'none' }} onPointerMove={onPointerMove} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
        <div />
        <div style={{ position: 'relative', height: 16 }}>
          {Array.from({ length: Math.floor(D * 2) + 1 }, (_, i) => i / 2).map((t) => (
            <span key={t} className="mono faint" style={{ position: 'absolute', left: `${(t / D) * 100}%`, fontSize: 10, transform: 'translateX(-50%)' }}>{t.toFixed(1)}</span>
          ))}
        </div>
        {TRACKS.map((tr) => (
          <div key={tr.id} style={{ display: 'contents' }}>
            <div className="eyebrow" style={{ alignSelf: 'center', fontSize: 10 }}>{tr.label}</div>
            <div ref={tr.id === 'attacker' ? lane : undefined} style={{ position: 'relative', height: 34, borderTop: '1px solid var(--line)', background: 'rgba(0,0,0,0.3)' }}>
              {events.map((e, i) => trackOf(e) === tr.id && (
                <div key={i} title={describe(e)}
                  onPointerDown={(ev) => { setSel(i); drag.current = { index: i, startX: ev.clientX, startT: e.t }; (ev.target as HTMLElement).setPointerCapture(ev.pointerId); }}
                  style={{
                    position: 'absolute', left: `${(e.t / D) * 100}%`, top: 6, height: 22, transform: 'translateX(-4px)', cursor: 'grab',
                    width: 'duration' in e && e.duration ? `max(10px, ${((e.duration as number) / D) * 100}%)` : 10,
                    background: EVENT_COLORS[e.type], opacity: sel === i ? 1 : 0.75, outline: sel === i ? '2px solid #fff' : 'none',
                    clipPath: 'duration' in e && e.duration ? undefined : 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                  }} />
              ))}
              <div style={{ position: 'absolute', left: `${(Math.min(playhead, D) / D) * 100}%`, top: 0, bottom: 0, width: 2, background: 'var(--amber-hi)', pointerEvents: 'none' }} />
            </div>
          </div>
        ))}
      </div>

      {selected && sel !== null && (
        <div className="row wrap" style={{ gap: 8, padding: 8, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--line)' }}>
          <span className="chip" style={{ background: EVENT_COLORS[selected.type], color: '#000' }}>{selected.type}</span>
          <Num label="t" value={selected.t} step={0.05} onChange={(v) => update(sel, { t: v })} />
          {'actor' in selected && <Sel label="actor" value={selected.actor} options={['attacker', 'defender']} onChange={(v) => update(sel, { actor: v } as never)} />}
          {selected.type === 'anim' && <><Sel label="action" value={selected.action} options={GAME_ACTIONS} onChange={(v) => update(sel, { action: v } as never)} /><Num label="speed" value={selected.speed ?? 1} step={0.1} onChange={(v) => update(sel, { speed: v } as never)} /></>}
          {selected.type === 'move' && <>
            <Sel label="to" value={selected.to} options={ANCHORS} onChange={(v) => update(sel, { to: v } as never)} />
            <Num label="duration" value={selected.duration} step={0.05} onChange={(v) => update(sel, { duration: v } as never)} />
            <Sel label="ease" value={selected.ease ?? 'inOut'} options={EASES} onChange={(v) => update(sel, { ease: v } as never)} />
            <Num label="arc" value={selected.arc ?? 0} step={0.1} onChange={(v) => update(sel, { arc: v } as never)} />
            <Sel label="anim" value={selected.action ?? ''} options={['', ...GAME_ACTIONS]} onChange={(v) => update(sel, { action: v || undefined } as never)} />
          </>}
          {selected.type === 'face' && <Sel label="toward" value={selected.toward} options={['other', 'forward', 'origin']} onChange={(v) => update(sel, { toward: v } as never)} />}
          {(selected.type === 'rotate') && <><Num label="yaw°" value={selected.yaw} step={15} onChange={(v) => update(sel, { yaw: v } as never)} /><Num label="duration" value={selected.duration} step={0.05} onChange={(v) => update(sel, { duration: v } as never)} /></>}
          {selected.type === 'impact' && <>
            <Sel label="strength" value={selected.strength} options={['light', 'medium', 'heavy', 'massive']} onChange={(v) => update(sel, { strength: v } as never)} />
            <Sel label="fx" value={selected.fx ?? ''} options={['', ...FX_IDS]} onChange={(v) => update(sel, { fx: v || undefined } as never)} />
            <Sel label="hit" value={selected.hit ?? ''} options={['', 'HIT_LIGHT', 'HIT_HEAVY']} onChange={(v) => update(sel, { hit: v || undefined } as never)} />
            <Num label="knock" value={selected.knock ?? 0} step={0.1} onChange={(v) => update(sel, { knock: v } as never)} />
          </>}
          {selected.type === 'fx' && <><Sel label="fx" value={selected.fx} options={FX_IDS} onChange={(v) => update(sel, { fx: v } as never)} /><Sel label="at" value={selected.at} options={['attacker', 'defender', 'between', 'target']} onChange={(v) => update(sel, { at: v } as never)} /></>}
          {selected.type === 'sound' && <Txt label="sound" value={selected.sound} onChange={(v) => update(sel, { sound: v } as never)} />}
          {(selected.type === 'shake') && <><Num label="strength" value={selected.strength} step={0.1} onChange={(v) => update(sel, { strength: v } as never)} /><Num label="duration" value={selected.duration} step={0.05} onChange={(v) => update(sel, { duration: v } as never)} /></>}
          {selected.type === 'death' && <Sel label="death" value={selected.deathType ?? 'auto'} options={['auto', ...DEATH_TYPE_IDS]} onChange={(v) => update(sel, { deathType: v } as never)} />}
          {selected.type === 'camera' && <><Sel label="shot" value={selected.shot} options={['push', 'low', 'orbit', 'side', 'focus', 'return']} onChange={(v) => update(sel, { shot: v } as never)} /><Num label="strength" value={selected.strength ?? 0.6} step={0.1} onChange={(v) => update(sel, { strength: v } as never)} /></>}
          {selected.type === 'slowmo' && <><Num label="scale" value={selected.scale} step={0.05} onChange={(v) => update(sel, { scale: v } as never)} /><Num label="duration" value={selected.duration} step={0.05} onChange={(v) => update(sel, { duration: v } as never)} /></>}
          {selected.type === 'pause_anim' && <Num label="duration" value={selected.duration} step={0.05} onChange={(v) => update(sel, { duration: v } as never)} />}
          <div className="grow" />
          <Btn size="small" variant="danger" onClick={() => remove(sel)}>Delete</Btn>
        </div>
      )}
    </div>
  );
}

function Num({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return <label className="row" style={{ gap: 4, fontSize: 12 }}><span className="faint mono">{label}</span><input className="input mono" type="number" step={step} value={value} style={{ width: 74, padding: '4px 6px' }} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}
function Txt({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="row" style={{ gap: 4, fontSize: 12 }}><span className="faint mono">{label}</span><input className="input mono" value={value} style={{ width: 120, padding: '4px 6px' }} onChange={(e) => onChange(e.target.value)} /></label>;
}
function Sel({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return <label className="row" style={{ gap: 4, fontSize: 12 }}><span className="faint mono">{label}</span><select className="input" value={value} style={{ padding: '4px 6px' }} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o} value={o}>{o || '—'}</option>)}</select></label>;
}
