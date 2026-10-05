// Wasteland Derby screen: race card with posted odds, bet slip, the secret
// back-room upgrade shop, live standings + race commentary while the horses
// run, and the results board with payouts and revealed upgrades. Players watch
// and bet. Nobody steers a horse.

import { useEffect, useMemo, useState } from 'react';
import {
  DERBY_BET_KINDS, DERBY_STAKES, DERBY_UPGRADES, DERBY_UPGRADE_IDS, DERBY_WEAPONS, FACTIONS,
  type DerbyBetKind, type DerbyEvent, type DerbyRunner, type DerbyState, type DerbyTimeline,
} from '@ashen/shared';
import { NetworkManager } from '../../core/NetworkManager';
import { useDerby, type DerbyCam } from '../../core/derbyStore';
import { useApp } from '../../core/store';
import { Btn, Panel, Seg, useNow } from '../common';
import { TopBar } from '../TopBar';

const STAT_KEYS = [['speed', 'SPD'], ['stamina', 'STA'], ['grit', 'GRT'], ['aggression', 'AGG'], ['accuracy', 'ACC']] as const;

export function DerbyScreen() {
  const st = useDerby((s) => s.state);
  const selected = useDerby((s) => s.selected);
  const cam = useDerby((s) => s.cam);
  const connection = useApp((s) => s.connection);
  const profile = useApp((s) => s.profile);
  const go = useApp((s) => s.go);
  useNow(250);
  const now = useDerby.getState().now();

  // Subscribe while the screen is open (and again after a reconnect).
  useEffect(() => {
    if (connection !== 'online') return;
    void NetworkManager.call('derby:watch', { on: true }, { quiet: true }).then((s) => { if (s) useDerby.getState().receive(s as DerbyState); }).catch(() => {});
    return () => { void NetworkManager.call('derby:watch', { on: false }, { quiet: true }).catch(() => {}); };
  }, [connection]);

  const focus = useDerby((s) => s.focus);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return; if (e.key === 'h' || e.key === 'H') useDerby.getState().setFocus(!useDerby.getState().focus); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const credits = st?.credits ?? profile?.credits ?? 0;
  const tau = st ? (now - st.startsAt) / 1000 : 0;
  const live = !!st?.timeline && (st.phase === 'racing' || st.phase === 'gates') && tau >= 0;

  return (
    <div className="screen pe-none">
      <div className="pe-auto"><TopBar back={() => go('lobby')} title="Wasteland Derby" /></div>
      {!st && <div className="center grow"><div className="eyebrow pulse">Grooming the horses…</div></div>}
      {st && focus && <FocusBar st={st} now={now} credits={credits} tau={tau} />}
      {st && !focus && (
        <>
          <div style={{ position: 'absolute', top: 70, left: 16, bottom: 16, width: 470, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }} className="pe-auto">
            <RaceHeader st={st} now={now} credits={credits} />
            {live || st.phase === 'results' ? <Standings st={st} tau={tau} /> : <RaceCard st={st} selected={selected} />}
            <TrackSide st={st} />
          </div>
          <div style={{ position: 'absolute', top: 70, right: 16, bottom: 16, width: 350, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }} className="pe-auto">
            {st.phase === 'betting' ? <><BetSlip st={st} selected={selected} credits={credits} /><BackRoom st={st} credits={credits} /></> : <Commentary st={st} tau={tau} />}
            <MyBets st={st} />
            {(live || st.phase === 'results') && (
              <Panel title="Camera">
                <Seg<DerbyCam> value={cam} onChange={(c) => useDerby.getState().setCam(c)} options={[{ value: 'auto', label: 'Director' }, { value: 'follow', label: 'Follow' }, { value: 'aerial', label: 'Aerial' }]} />
                <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Follow tracks the selected horse, or your first bet.</div>
              </Panel>
            )}
          </div>
          {st.phase === 'results' && <ResultsBoard st={st} now={now} />}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ header
function RaceHeader({ st, now, credits }: { st: DerbyState; now: number; credits: number }) {
  const secs = (t: number) => Math.max(0, Math.ceil((t - now) / 1000));
  const status = st.phase === 'betting' ? <>Betting closes in <b className="amber mono">{fmt(secs(st.bettingClosesAt))}</b></>
    : st.phase === 'gates' ? <b className="amber">Loading the gates…</b>
    : st.phase === 'racing' ? <b className="red pulse">THEY'RE OFF</b>
    : <>Next race in <b className="mono">{fmt(secs((st.endsAt ?? now) + 14_000))}</b></>;
  return (
    <section className="panel" style={{ padding: '12px 14px' }}>
      <div className="row between">
        <div className="col" style={{ gap: 2 }}>
          <div className="eyebrow">Race {st.number} · {Math.round(st.distance * 2)} m · {st.watchers} watching</div>
          <h2 style={{ margin: 0, fontSize: 22 }}>{st.name}</h2>
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
          <span className="eyebrow">Bank</span>
          <b className="mono amber" style={{ fontSize: 22 }}>{credits.toLocaleString()} cr</b>
        </div>
      </div>
      <div className="row between" style={{ marginTop: 8, fontSize: 14 }}>
        <span>{status}</span>
        <button className="btn small ghost" title="Hide the panels and watch the race (H)" onClick={() => useDerby.getState().setFocus(true)}>Focus view</button>
        {st.secretUpgrades > 0 && st.phase !== 'results' && <span className="chip cyan" title="Someone paid the stable hands. Nobody knows who, or which horse.">{st.secretUpgrades} secret deal{st.secretUpgrades > 1 ? 's' : ''}</span>}
      </div>
      {st.history.length > 0 && (
        <div className="row wrap faint" style={{ gap: 6, marginTop: 8, fontSize: 11 }}>
          Recent: {st.history.slice(0, 5).map((h) => <span key={h.number} className="chip" style={{ fontSize: 10 }}>{h.winnerName} @{h.odds}</span>)}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ race card
function RaceCard({ st, selected }: { st: DerbyState; selected: string | null }) {
  return (
    <Panel title="Race card" right={<span className="faint mono" style={{ fontSize: 11 }}>odds: win · place · show</span>} className="grow" style={{ minHeight: 190 }} bodyClass="scroll">
      <div className="col" style={{ gap: 6 }}>
        {st.runners.map((r) => (
          <button key={r.id} className="list-item" onClick={() => useDerby.getState().select(selected === r.id ? null : r.id)}
            style={{ textAlign: 'left', color: 'inherit', cursor: 'pointer', border: `1px solid ${selected === r.id ? 'var(--cyan)' : 'transparent'}`, background: selected === r.id ? 'rgba(111,224,255,0.08)' : 'rgba(255,255,255,0.02)', display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 10, alignItems: 'center', padding: '8px 10px' }}>
            <Cloth r={r} />
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}><b className="truncate">{r.horse}</b><span className="faint" style={{ fontSize: 11 }}>form {r.form}</span></div>
              <div className="faint truncate" style={{ fontSize: 11 }}>{r.jockey} · {FACTIONS[r.faction].name.replace('The ', '')} · {DERBY_WEAPONS[r.weapon].name}</div>
              <div className="row" style={{ gap: 6, marginTop: 2 }}>
                {STAT_KEYS.map(([k, label]) => <StatBar key={k} label={label} v={r.stats[k]} />)}
              </div>
              <Bookings list={st.bookings[r.id]} />
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
              <b className="mono amber" style={{ fontSize: 18 }}>{r.odds.win.toFixed(r.odds.win < 10 ? 1 : 0)}</b>
              <span className="mono faint" style={{ fontSize: 11 }}>{r.odds.place.toFixed(1)} · {r.odds.show.toFixed(1)}</span>
              {(st.backers[r.id] ?? 0) > 0 && <span className="faint" style={{ fontSize: 10 }}>{st.backers[r.id]} backing</span>}
            </div>
          </button>
        ))}
      </div>
    </Panel>
  );
}

/** Who has money on this runner (public). */
function Bookings({ list }: { list?: { name: string; kind: DerbyBetKind; stake: number; you?: boolean }[] }) {
  if (!list?.length) return null;
  return (
    <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
      {list.slice(0, 6).map((b, i) => (
        <span key={i} className="chip" style={{ fontSize: 9.5, borderColor: b.you ? 'var(--amber)' : undefined }}>{b.you ? 'You' : b.name} · {b.kind} {b.stake}</span>
      ))}
      {list.length > 6 && <span className="faint" style={{ fontSize: 10 }}>+{list.length - 6} more</span>}
    </div>
  );
}

/** Focus view: a slim strip so the 3D race fills the screen. */
function FocusBar({ st, now, credits, tau }: { st: DerbyState; now: number; credits: number; tau: number }) {
  const tl = st.timeline;
  const live = !!tl && tau >= 0 && st.phase !== 'betting';
  const order = live && tl ? (() => {
    const i = Math.max(0, Math.min(tl.frames.length - 1, Math.floor(tau / tl.step)));
    const f = tl.frames[i];
    return tl.runners.map((id, k) => ({ id, s: f[k * 4] })).sort((a, b) => b.s - a.s).slice(0, 4);
  })() : [];
  const secs = Math.max(0, Math.ceil(((st.phase === 'betting' ? st.bettingClosesAt : st.startsAt) - now) / 1000));
  const mine = new Set(st.myBets.map((b) => b.runnerId));
  return (
    <div className="pe-auto" style={{ position: 'absolute', left: '50%', bottom: 18, transform: 'translateX(-50%)', display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', background: 'rgba(12,10,8,0.82)', border: '1px solid rgba(232,162,58,0.35)', borderRadius: 10, maxWidth: 'calc(100vw - 32px)', flexWrap: 'wrap' }}>
      <b style={{ fontFamily: 'var(--font-head)', letterSpacing: '0.06em' }}>{st.name}</b>
      <span className="faint mono" style={{ fontSize: 12 }}>{st.phase === 'betting' ? `betting ${secs}s` : st.phase === 'results' ? 'results' : live ? `${Math.floor(tau)}s` : `off in ${secs}s`}</span>
      {order.map((o, i) => {
        const r = st.runners.find((x) => x.id === o.id)!;
        return <span key={o.id} className="row" style={{ gap: 4, fontSize: 13, color: mine.has(o.id) ? 'var(--amber)' : undefined }}><b className="mono">{i + 1}</b><Cloth r={r} size={18} />{r.horse}</span>;
      })}
      <span className="mono amber" style={{ fontSize: 13 }}>{credits.toLocaleString()} cr</span>
      <button className="btn small" onClick={() => useDerby.getState().setFocus(false)} title="Show the panels (H)">Show panels</button>
    </div>
  );
}

function Cloth({ r, size = 30 }: { r: DerbyRunner; size?: number }) {
  return <div style={{ width: size, height: size, borderRadius: 6, background: r.silks, color: '#111', display: 'grid', placeItems: 'center', fontWeight: 800, fontFamily: 'var(--font-head)', fontSize: size * 0.55, boxShadow: 'inset 0 -3px 0 rgba(0,0,0,0.25)' }}>{r.number}</div>;
}

function StatBar({ label, v }: { label: string; v: number }) {
  return (
    <div className="col" style={{ gap: 1, width: 52 }}>
      <span className="mono faint" style={{ fontSize: 9 }}>{label}</span>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}><div style={{ width: `${v * 10}%`, height: '100%', borderRadius: 2, background: v >= 8 ? 'var(--amber)' : 'rgba(242,230,204,0.6)' }} /></div>
    </div>
  );
}

// ------------------------------------------------------------------ betting
function BetSlip({ st, selected, credits }: { st: DerbyState; selected: string | null; credits: number }) {
  const runner = st.runners.find((r) => r.id === selected);
  const [kind, setKind] = useState<DerbyBetKind>('win');
  const [stake, setStake] = useState(50);
  const [busy, setBusy] = useState(false);
  const odds = runner?.odds[kind] ?? 0;
  const place = async () => {
    if (!runner) return;
    setBusy(true);
    try {
      await NetworkManager.call('derby:bet', { raceId: st.raceId, runnerId: runner.id, kind, stake });
      useApp.getState().toast('success', `${stake} cr on ${runner.horse} to ${kind} @ ${odds}`);
    } catch { /* toast shown by the network layer */ } finally { setBusy(false); }
  };
  return (
    <Panel title="Bet slip">
      {!runner ? <div className="empty">Pick a horse from the race card.</div> : (
        <div className="col" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10 }}><Cloth r={runner} /><div className="col" style={{ gap: 0 }}><b>{runner.horse}</b><span className="faint" style={{ fontSize: 11 }}>{runner.jockey} · gate {runner.number}</span></div></div>
          <Seg<DerbyBetKind> value={kind} onChange={setKind} options={DERBY_BET_KINDS.map((k) => ({ value: k.id, label: <span title={k.hint}>{k.name} {runner.odds[k.id]}</span> }))} />
          <div className="row" style={{ gap: 6 }}>
            <input className="input mono" type="number" min={DERBY_STAKES.min} max={Math.min(DERBY_STAKES.max, credits)} value={stake} onChange={(e) => setStake(Math.max(0, Math.floor(Number(e.target.value) || 0)))} style={{ width: 90 }} />
            {[10, 50, 100, 250].map((v) => <Btn key={v} size="small" variant="ghost" onClick={() => setStake(v)}>{v}</Btn>)}
          </div>
          <div className="row between" style={{ fontSize: 13 }}>
            <span className="faint">{DERBY_BET_KINDS.find((k) => k.id === kind)!.hint}</span>
            <span>Returns <b className="mono amber">{Math.round(stake * odds)}</b></span>
          </div>
          <Btn variant="primary" block disabled={busy || stake < DERBY_STAKES.min || stake > credits || stake > DERBY_STAKES.max} onClick={place}>Place bet</Btn>
        </div>
      )}
    </Panel>
  );
}

function BackRoom({ st, credits }: { st: DerbyState; credits: number }) {
  const backed = [...new Set(st.myBets.map((b) => b.runnerId))].map((id) => st.runners.find((r) => r.id === id)!).filter(Boolean);
  const [target, setTarget] = useState<string | null>(null);
  const horse = backed.find((r) => r.id === target) ?? backed[0];
  const owned = new Set(st.myUpgrades.filter((u) => u.runnerId === horse?.id).map((u) => u.upgradeId));
  return (
    <Panel title="Back room" right={<span className="chip cyan" style={{ fontSize: 10 }}>secret</span>} className="grow" style={{ minHeight: 190 }} bodyClass="scroll">
      {!horse ? <div className="empty">Back a horse and the stable hands will talk to you. Pay them to give it an edge. The odds won't move, and nobody else will know.</div> : (
        <div className="col" style={{ gap: 6 }}>
          {backed.length > 1 && <Seg<string> value={horse.id} onChange={setTarget} options={backed.map((r) => ({ value: r.id, label: `#${r.number}` }))} />}
          <div className="faint" style={{ fontSize: 11 }}>Deals for <b>{horse.horse}</b> and {horse.jockey}. {4 - st.myUpgrades.length} left this race.</div>
          {DERBY_UPGRADE_IDS.map((id) => {
            const u = DERBY_UPGRADES[id];
            const have = owned.has(id);
            return (
              <div key={id} className="list-item" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', padding: '6px 8px' }}>
                <div className="col" style={{ gap: 1 }}>
                  <div className="row" style={{ gap: 6 }}><b style={{ fontSize: 13 }}>{u.name}</b><span className="chip" style={{ fontSize: 9 }}>{u.target}</span></div>
                  <span className="faint" style={{ fontSize: 11 }}>{u.description}</span>
                </div>
                <Btn size="small" variant={have ? 'ghost' : 'cyan'} disabled={have || u.cost > credits || st.myUpgrades.length >= 4}
                  onClick={() => void NetworkManager.call('derby:upgrade', { raceId: st.raceId, runnerId: horse.id, upgradeId: id }).then(() => useApp.getState().toast('info', `${u.name} arranged for ${horse.horse}. Keep it quiet.`)).catch(() => {})}>
                  {have ? 'Done' : `${u.cost} cr`}
                </Btn>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function MyBets({ st }: { st: DerbyState }) {
  if (!st.myBets.length && !st.myUpgrades.length) return null;
  const name = (id: string) => st.runners.find((r) => r.id === id);
  return (
    <Panel title="Your ticket" right={<span className="faint mono" style={{ fontSize: 11 }}>{st.myBets.reduce((a, b) => a + b.stake, 0)} cr staked</span>}>
      <div className="col" style={{ gap: 4 }}>
        {st.myBets.map((b) => {
          const r = name(b.runnerId)!;
          return (
            <div key={b.id} className="row between" style={{ fontSize: 13 }}>
              <span className="row" style={{ gap: 6 }}><Cloth r={r} size={20} />{r.horse} <span className="faint">{b.kind} @{b.odds}</span></span>
              <span className="row" style={{ gap: 6 }}>
                <b className="mono">{b.stake}</b>
                {b.payout !== undefined && <b className={`mono ${b.payout > 0 ? 'green' : 'red'}`}>{b.payout > 0 ? `+${b.payout}` : 'lost'}</b>}
                {st.phase === 'betting' && <button className="icon-btn" style={{ width: 22, height: 22, fontSize: 11 }} title="Cancel bet" onClick={() => void NetworkManager.call('derby:cancel', { raceId: st.raceId, betId: b.id }).catch(() => {})}>✕</button>}
              </span>
            </div>
          );
        })}
        {st.myUpgrades.length > 0 && <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Secret deals: {st.myUpgrades.map((u) => `${DERBY_UPGRADES[u.upgradeId].name} (#${name(u.runnerId)?.number})`).join(', ')}</div>}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ live race
function frameAt(tl: DerbyTimeline, tau: number) {
  const i = Math.max(0, Math.min(tl.frames.length - 1, Math.floor(tau / tl.step)));
  return tl.frames[i];
}

function Standings({ st, tau }: { st: DerbyState; tau: number }) {
  const tl = st.timeline;
  const rows = useMemo(() => {
    if (!tl) return [];
    const f = frameAt(tl, Math.max(0, tau));
    const done = (id: string) => tl.finishTimes[id] !== undefined && tl.finishTimes[id] <= tau;
    return tl.runners.map((id, k) => ({ id, s: f[k * 4], hp: f[k * 4 + 2], flags: f[k * 4 + 3], done: done(id), place: tl.finishOrder.indexOf(id) + 1 }))
      .sort((a, b) => (a.done && b.done ? a.place - b.place : a.done ? -1 : b.done ? 1 : b.s - a.s));
  }, [tl, tau]);
  const mine = new Set(st.myBets.map((b) => b.runnerId));
  const lead = rows[0]?.s ?? 0;
  const progress = Math.max(0, Math.min(1, lead / st.distance));
  return (
    <Panel title={st.phase === 'results' ? 'Final order' : 'Running order'} right={<span className="mono faint" style={{ fontSize: 11 }}>{Math.round(progress * 100)}%</span>} className="grow" style={{ minHeight: 190 }} bodyClass="scroll">
      <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginBottom: 10 }}><div style={{ width: `${progress * 100}%`, height: '100%', background: 'var(--amber)', borderRadius: 2 }} /></div>
      <div className="col" style={{ gap: 4 }}>
        {rows.map((row, i) => {
          const r = st.runners.find((x) => x.id === row.id)!;
          const gap = i === 0 ? '' : row.done ? `+${(tl!.finishTimes[row.id] - tl!.finishTimes[rows[0].id]).toFixed(2)}s` : `${((lead - row.s) / 1.1).toFixed(1)} L`;
          return (
            <button key={row.id} className="list-item" onClick={() => useDerby.getState().select(row.id)}
              style={{ display: 'grid', gridTemplateColumns: '22px 26px 1fr 70px 56px', gap: 8, alignItems: 'center', padding: '5px 8px', color: 'inherit', cursor: 'pointer', textAlign: 'left', border: `1px solid ${mine.has(row.id) ? 'rgba(232,162,58,0.6)' : 'transparent'}`, background: 'rgba(255,255,255,0.02)' }}>
              <b className="mono" style={{ color: i === 0 ? 'var(--amber)' : undefined }}>{i + 1}</b>
              <Cloth r={r} size={22} />
              <span className="truncate" title={(st.bookings[row.id] ?? []).map((b) => `${b.name}: ${b.kind} ${b.stake}`).join('\n')}>{r.horse}{(st.bookings[row.id] ?? []).length ? <span className="faint" style={{ fontSize: 10 }}> · {(st.bookings[row.id] ?? []).map((b) => b.you ? 'you' : b.name).filter((n, i, a) => a.indexOf(n) === i).slice(0, 3).join(', ')}</span> : null} {row.flags & 8 ? <span className="red">· DOWN</span> : row.flags & 2 ? <span className="amber">· NITRO</span> : row.flags & 4 ? <span className="faint">· smoke</span> : row.flags & 1 ? <span className="faint">· rattled</span> : null}</span>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}><div style={{ width: `${row.hp}%`, height: '100%', borderRadius: 2, background: row.hp > 50 ? 'var(--green)' : row.hp > 25 ? 'var(--amber)' : 'var(--red)' }} /></div>
              <span className="mono faint" style={{ fontSize: 11, textAlign: 'right' }}>{row.done ? `${tl!.finishTimes[row.id].toFixed(2)}s` : gap}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function Commentary({ st, tau }: { st: DerbyState; tau: number }) {
  const tl = st.timeline;
  const lines = useMemo(() => {
    if (!tl) return [];
    const byId = new Map(st.runners.map((r) => [r.id, r]));
    return tl.events.filter((e) => e.t <= tau && e.kind !== 'attack' && e.kind !== 'remount').slice(-9).reverse().map((e, i) => ({ key: `${e.t}-${e.kind}-${e.runner}-${i}`, t: e.t, text: describe(e, byId) }));
  }, [tl, tau, st.runners]);
  return (
    <Panel title="Race call" className="grow" style={{ minHeight: 190 }} bodyClass="scroll">
      {st.phase === 'gates' && <div className="eyebrow pulse">Horses are in the gates. Betting is closed.</div>}
      <div className="col" style={{ gap: 6 }}>
        {lines.map((l, i) => <div key={l.key} style={{ fontSize: 13, opacity: 1 - i * 0.08 }}><span className="mono faint" style={{ fontSize: 10 }}>{l.t.toFixed(1)}s </span>{l.text}</div>)}
      </div>
    </Panel>
  );
}

function describe(e: DerbyEvent, byId: Map<string, DerbyRunner>): string {
  const n = (id?: string) => byId.get(id ?? '')?.horse ?? '???';
  const j = (id?: string) => byId.get(id ?? '')?.jockey ?? 'the jockey';
  const w = e.weapon ? DERBY_WEAPONS[e.weapon].name.toLowerCase() : 'weapon';
  switch (e.kind) {
    case 'hit': return `${j(e.runner)} connects with the ${w} — ${n(e.target)} takes ${e.damage}!`;
    case 'miss': return `${j(e.runner)} swings the ${w} at ${n(e.target)}… and misses.`;
    case 'dodge': return `${j(e.runner)} ducks under it — trick riding on ${n(e.runner)}!`;
    case 'counter': return `${n(e.runner)} lashes out with spiked shoes at ${n(e.target)}!`;
    case 'boost': return `${n(e.runner)} ERUPTS — somebody fed that horse nitro oats!`;
    case 'smoke': return `Smoke bombs from ${j(e.runner)}! ${n(e.runner)} vanishes in the haze.`;
    case 'grapple': return `${j(e.runner)} fires a grapple into ${n(e.target)} and slingshots past!`;
    case 'heal': return `${j(e.runner)} slaps a med patch on ${n(e.runner)} at full gallop.`;
    case 'stumble': return `${n(e.runner)} stumbles on the broken ground.`;
    case 'wipeout': return `${n(e.runner)} GOES DOWN${e.target ? ` after that hit from ${n(e.target)}` : ''}!`;
    case 'lead': return `${n(e.runner)} takes the lead.`;
    case 'finish': return e.place === 1 ? `${n(e.runner)} WINS IT!` : `${n(e.runner)} home in ${ordinal(e.place ?? 0)}.`;
    default: return `${n(e.runner)} ${e.kind}`;
  }
}

// ------------------------------------------------------------------ track-side (who's here + chat)
function TrackSide({ st }: { st: DerbyState }) {
  const chat = useDerby((s) => s.chat);
  const me = useApp((s) => s.profile?.id);
  const [text, setText] = useState('');
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    void NetworkManager.call('derby:chat', { text: t }).catch(() => {});
  };
  return (
    <Panel title="Track-side" right={<span className="chip green">{st.punters.length} here</span>} style={{ height: 210, minHeight: 210, display: 'flex', flexDirection: 'column' }} bodyClass="col grow" >
      <div className="row wrap" style={{ gap: 4, marginBottom: 6 }}>
        {st.punters.slice(0, 14).map((p) => <span key={p.id} className="chip" style={{ fontSize: 10, borderColor: p.id === me ? 'var(--amber)' : undefined }}>{p.name}{p.bets ? ` · ${p.bets} bet${p.bets > 1 ? 's' : ''}` : ''}</span>)}
      </div>
      <div className="scroll grow" style={{ minHeight: 0, fontSize: 12 }}>
        {chat.length === 0 && <div className="faint">Talk trash. Brag about the horse you secretly fed nitro oats (or don't).</div>}
        {chat.slice(-30).map((m, i) => <div key={i}><b style={{ color: m.from === me ? 'var(--amber)' : undefined }}>{m.name}:</b> {m.text}</div>)}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <input className="input" style={{ flex: 1, padding: '4px 8px' }} maxLength={200} value={text} placeholder="Say something…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
        <Btn size="small" onClick={send}>Send</Btn>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ results
function ResultsBoard({ st, now }: { st: DerbyState; now: number }) {
  const [open, setOpen] = useState(true);
  useEffect(() => { setOpen(true); }, [st.raceId]);
  if (!open || !st.results) return null;
  const byId = new Map(st.runners.map((r) => [r.id, r]));
  const net = st.myNet;
  return (
    <div className="pe-auto" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 520, maxWidth: 'calc(100vw - 32px)' }}>
      <section className="panel" style={{ padding: 18, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div className="row between">
          <div className="col" style={{ gap: 2 }}><span className="eyebrow">Result · race {st.number}</span><h2 style={{ margin: 0 }}>{st.name}</h2></div>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>
        <div className="col" style={{ gap: 4, marginTop: 12 }}>
          {st.results.slice(0, 4).map((r) => {
            const run = byId.get(r.runnerId)!;
            return (
              <div key={r.runnerId} className="row between" style={{ fontSize: r.place === 1 ? 18 : 14 }}>
                <span className="row" style={{ gap: 8 }}><b className="mono" style={{ width: 26 }}>{ordinal(r.place)}</b><Cloth r={run} size={r.place === 1 ? 28 : 22} /><b>{run.horse}</b><span className="faint" style={{ fontSize: 12 }}>{run.jockey}</span></span>
                <span className="mono faint">{r.time.toFixed(2)}s · {run.odds.win}</span>
              </div>
            );
          })}
        </div>
        {net !== null && (
          <div className="row between" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: net >= 0 ? 'rgba(90,200,120,0.12)' : 'rgba(220,80,60,0.12)' }}>
            <span>Your race</span><b className={`mono ${net >= 0 ? 'green' : 'red'}`} style={{ fontSize: 20 }}>{net >= 0 ? '+' : ''}{net} cr</b>
          </div>
        )}
        {st.revealed && st.revealed.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="eyebrow">Back-room deals, revealed</div>
            <div className="col" style={{ gap: 2, marginTop: 4, maxHeight: 120, overflow: 'auto' }}>
              {st.revealed.map((x, i) => <div key={i} className="faint" style={{ fontSize: 12 }}><b style={{ color: 'var(--text)' }}>{x.buyer}</b> paid for {DERBY_UPGRADES[x.upgradeId].name} on {byId.get(x.runnerId)?.horse}</div>)}
            </div>
          </div>
        )}
        <div className="faint" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>Next card in {fmt(Math.max(0, Math.ceil(((st.endsAt ?? now) + 14_000 - now) / 1000)))}</div>
      </section>
    </div>
  );
}

function fmt(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function ordinal(n: number) { return `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`; }
