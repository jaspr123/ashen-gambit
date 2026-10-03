// In-match HUD for players, spectators and replays. Sits over the live board;
// the board itself is always the stage for fights.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ABILITIES_BY_ID, GAME_MODES, other, timeControlLabel, type Color, type MoveRecord, type PieceType,
} from '@ashen/shared';
import { useApp } from '../../core/store';
import { useSettings } from '../../core/settings';
import { FactionManager } from '../../game/FactionManager';
import { GameController, useGame, type HudPlayer } from '../../game/GameController';
import { StageHandle } from '../../scene/GameCanvas';
import { Avatar, Btn, FactionBadge, PIECE_GLYPH, formatClock, useNow } from '../common';
import { TauntPopup } from './TauntPopup';
import { DraftOverlay } from './DraftOverlay';

const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const REASON: Record<string, string> = {
  checkmate: 'by checkmate', stalemate: 'stalemate', resign: 'by resignation', timeout: 'on time', abandon: 'by abandonment',
  threefold: 'threefold repetition', fifty_move: 'fifty-move rule', insufficient: 'insufficient material', agreement: 'by agreement', aborted: 'game aborted',
};

export function GameHud() {
  const g = useGame();
  const go = useApp((s) => s.go);
  const [flipped, setFlipped] = useState(false);
  const bottom: Color = (g.me === 'b' ? 'b' : 'w') === 'w' ? (flipped ? 'b' : 'w') : flipped ? 'w' : 'b';
  const top = other(bottom);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === ' ' && g.animating) { e.preventDefault(); GameController.skip(); }
      if (e.key === 'Escape') { GameController.cancelAbility(); useGame.setState({ selected: null }); GameController.refreshOverlays(); }
      if (g.kind === 'replay') {
        if (e.key === 'ArrowRight') GameController.replayStep(1);
        if (e.key === 'ArrowLeft') GameController.replayStep(-1);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [g.animating, g.kind]);

  const flip = () => { setFlipped((f) => !f); StageHandle.current?.camera.flip(); };
  const leave = () => { GameController.leave(); go('lobby'); };
  const isPlayer = g.kind === 'online' || g.kind === 'local' || g.kind === 'ai';
  const spectator = g.kind === 'spectate';

  return (
    <div className="screen pe-none" style={{ animation: 'none' }}>
      {/* ---------------------------------------------------- top row */}
      <div className="row pe-none" style={{ padding: '14px 18px', alignItems: 'flex-start', gap: 14 }}>
        <div className="row pe-auto" style={{ gap: 8 }}>
          <button className="icon-btn" title="Back to lobby" onClick={leave}>←</button>
          <div className="col" style={{ gap: 2 }}>
            <div className="eyebrow">{spectator ? 'Spectating' : g.kind === 'replay' ? 'Replay' : g.kind === 'ai' ? 'Practice' : g.kind === 'local' ? 'Local match' : 'Live match'} · {GAME_MODES[g.mode].name}</div>
            <div className="mono faint" style={{ fontSize: 11 }}>{timeControlLabel(g.timeControl)}{g.spectators ? ` · ${g.spectators} watching` : ''}{g.abilityVisibility !== 'off' && g.mode === 'war' ? ` · abilities ${g.abilityVisibility}` : ''}</div>
          </div>
        </div>
        <div className="grow" />
        <PlayerBar color={top} player={g.players[top]} active={g.turn === top && g.status === 'playing'} atTop />
        <div className="grow" />
        <div className="row pe-auto" style={{ gap: 6 }}>
          <button className="icon-btn" title="Flip board" onClick={flip}>⇅</button>
          <button className="icon-btn" title="Reset camera" onClick={() => StageHandle.current?.camera.resetView()}>⌖</button>
          {spectator && <button className="icon-btn" title="Free camera" onClick={() => { const c = StageHandle.current?.camera; if (c) c.setMode(c.mode === 'free' ? 'tactical' : 'free'); }}>✥</button>}
          <button className="icon-btn" title="Settings" onClick={() => go('settings')}>⚙</button>
        </div>
      </div>

      <div className="grow" />

      {/* ---------------------------------------------------- right column */}
      <div className="pe-auto hud-side" style={{ position: 'absolute', right: 18, top: 90, bottom: 18, width: 300, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <MoveList history={g.history} />
        {(g.kind === 'online' || g.kind === 'spectate') && <ChatBox />}
      </div>

      {/* ---------------------------------------------------- left: abilities */}
      {g.abilityView && (g.me !== 'spectator' || g.kind === 'local') && <AbilityBar />}

      {/* ---------------------------------------------------- bottom row */}
      <div className="row pe-none" style={{ padding: '0 18px 16px', alignItems: 'flex-end', gap: 14 }}>
        <div className="row pe-auto" style={{ gap: 6 }}>
          {isPlayer && g.status === 'playing' && <>
            <Btn size="small" variant="danger" onClick={() => { if (confirm('Resign this match?')) GameController.resign(); }}>Resign</Btn>
            {g.kind === 'online' && (g.drawOffer && g.drawOffer !== g.me
              ? <><Btn size="small" variant="primary" onClick={() => GameController.offerDraw('accept')}>Accept draw</Btn><Btn size="small" variant="ghost" onClick={() => GameController.offerDraw('decline')}>Decline</Btn></>
              : <Btn size="small" variant="ghost" disabled={!!g.drawOffer} onClick={() => GameController.offerDraw('offer')}>{g.drawOffer ? 'Draw offered' : 'Offer draw'}</Btn>)}
          </>}
          {(g.kind === 'online' || g.kind === 'local' || g.kind === 'ai') && <Emotes />}
        </div>
        <div className="grow" />
        <PlayerBar color={bottom} player={g.players[bottom]} active={g.turn === bottom && g.status === 'playing'} you={g.me === bottom} />
        <div className="grow" />
        <div style={{ width: 300 }} />
      </div>

      {g.kind === 'replay' && <ReplayControls />}
      <CenterLayer />
      {g.promotion && <PromotionPicker color={g.turn} />}
      {g.status === 'ended' && g.result && !g.animating && <ResultCard onLeave={leave} />}
      <TauntPopup />
      <ArcadeTimer />
      {g.status === 'picking' && g.pick && g.me !== 'spectator' && <DraftOverlay />}
    </div>
  );
}

// ---------------------------------------------------------------------------- player bar + clock
function PlayerBar({ color, player, active, you, atTop }: { color: Color; player: HudPlayer; active: boolean; you?: boolean; atTop?: boolean }) {
  const captured = useGame((s) => s.captured[color]);
  const capturedOther = useGame((s) => s.captured[other(color)]);
  const timed = useGame((s) => s.timeControl.minutes > 0);
  const inCheck = useGame((s) => s.inCheck && s.turn === color && s.status === 'playing');
  useNow(500);
  const emoteRaw = useGame((s) => (s.emote && s.emote.color === color ? s.emote : null));
  const emote = emoteRaw && Date.now() - emoteRaw.at < 3500 ? emoteRaw : null;
  const diff = captured.reduce((a, p) => a + VALUE[p], 0) - capturedOther.reduce((a, p) => a + VALUE[p], 0);
  return (
    <section className="panel pe-auto" style={{ minWidth: 380, borderColor: active ? 'var(--amber)' : undefined, transition: 'border-color 0.3s', overflow: 'visible' }}>
      <div className="row" style={{ padding: '8px 12px', gap: 12 }}>
        <span className="dot" style={{ width: 10, height: 10, background: color === 'w' ? 'var(--white-side)' : 'var(--black-side)', boxShadow: active ? `0 0 10px ${color === 'w' ? 'var(--white-side)' : 'var(--black-side)'}` : 'none' }} />
        <Avatar id={player.avatar} size={36} />
        <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <b className="truncate" style={{ fontSize: 16 }}>{player.name}</b>
            {player.rating ? <span className="mono faint" style={{ fontSize: 11 }}>{player.rating}</span> : null}
            {you && <span className="chip amber" style={{ fontSize: 9 }}>you</span>}
            {!player.connected && <span className="chip red pulse" style={{ fontSize: 9 }}>reconnecting</span>}
            {inCheck && <span className="chip red pulse" style={{ fontSize: 9 }}>check</span>}
          </div>
          <div className="row" style={{ gap: 8, fontSize: 13 }}>
            <FactionBadge id={player.faction} />
            <span style={{ letterSpacing: -1, fontSize: 15, color: 'var(--text-dim)' }}>{[...captured].sort((a, b) => VALUE[b] - VALUE[a]).map((p, i) => <span key={i}>{PIECE_GLYPH[p]}</span>)}</span>
            {diff > 0 && <span className="mono green" style={{ fontSize: 11 }}>+{diff}</span>}
          </div>
        </div>
        {timed && <Clock color={color} active={active} />}
      </div>
      {/* Bubble below the top plate (above it would be off-screen), above the bottom one. */}
      {emote && <div style={{ position: 'absolute', left: '50%', ...(atTop ? { top: 'calc(100% + 8px)' } : { top: -34 }), transform: 'translateX(-50%)', animation: 'screen-in 0.2s', zIndex: 5 }} className="chip amber">{EMOTES[emote.emote] ?? emote.emote}</div>}
    </section>
  );
}

function Clock({ color, active }: { color: Color; active: boolean }) {
  useNow(100);
  const ms = GameController.clockLeft(color);
  const low = ms < 30_000;
  return (
    <div className="mono" style={{ fontSize: 26, fontWeight: 600, padding: '2px 10px', minWidth: 96, textAlign: 'right', background: active ? 'rgba(232,162,58,0.15)' : 'rgba(0,0,0,0.35)', color: low && active ? 'var(--red)' : active ? 'var(--amber-hi)' : 'var(--text-dim)', border: `1px solid ${active ? 'var(--amber)' : 'var(--line)'}` }}>
      {formatClock(ms)}
    </div>
  );
}

// ---------------------------------------------------------------------------- move list
function MoveList({ history }: { history: MoveRecord[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [history.length]);
  const rows = useMemo(() => {
    const out: { n: number; w?: MoveRecord; b?: MoveRecord }[] = [];
    for (const m of history) {
      const n = Math.ceil(m.ply / 2);
      let row = out[out.length - 1];
      if (!row || row.n !== n) { row = { n }; out.push(row); }
      row[m.color] = m;
    }
    return out;
  }, [history]);
  const cell = (m?: MoveRecord) => m ? <span style={{ color: m.ability ? 'var(--cyan)' : m.captured ? 'var(--amber-hi)' : undefined }}>{m.san}</span> : null;
  return (
    <section className="panel" style={{ flex: '1 1 50%', minHeight: 120, display: 'flex', flexDirection: 'column' }}>
      <div className="panel-head"><h3>Battle log</h3><span className="chip">{history.length} plies</span></div>
      <div ref={ref} className="scroll" style={{ flex: 1, padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
        {rows.length === 0 && <div className="empty">No moves yet</div>}
        {rows.map((r) => (
          <div key={r.n} style={{ display: 'grid', gridTemplateColumns: '34px 1fr 1fr', padding: '2px 0' }}>
            <span className="faint">{r.n}.</span>{cell(r.w)}{cell(r.b)}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------- chat + emotes
export const EMOTES: Record<string, string> = { gg: 'GG', wow: 'Wow!', taunt: 'Come on then', salute: '⛨ Salute', oops: 'Oops', thinking: 'Hmm…' };

function ChatBox() {
  const chat = useGame((s) => s.chat);
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [chat.length]);
  return (
    <section className="panel" style={{ flex: '1 1 40%', minHeight: 140, display: 'flex', flexDirection: 'column' }}>
      <div className="panel-head"><h3>Comms</h3></div>
      <div ref={ref} className="scroll" style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}>
        {chat.length === 0 && <div className="faint">Channel open.</div>}
        {chat.map((m, i) => <div key={i}><b className="amber">{m.name}:</b> <span>{m.text}</span></div>)}
      </div>
      <form className="row" style={{ padding: 8 }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) { GameController.chat(text.trim()); setText(''); } }}>
        <input className="input grow" value={text} maxLength={200} placeholder="Say something…" onChange={(e) => setText(e.target.value)} />
      </form>
    </section>
  );
}

function Emotes() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <Btn size="small" variant="ghost" onClick={() => setOpen((o) => !o)}>Emote</Btn>
      {open && (
        <div className="panel" style={{ position: 'absolute', bottom: 40, left: 0, padding: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, width: 220 }}>
          {Object.entries(EMOTES).map(([k, v]) => <button key={k} className="btn small ghost" onClick={() => { GameController.emote(k as never); setOpen(false); }}>{v}</button>)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- War Chess abilities
function AbilityBar() {
  const view = useGame((s) => s.abilityView)!;
  const ability = useGame((s) => s.ability);
  const turn = useGame((s) => s.turn);
  const me = useGame((s) => s.me);
  const status = useGame((s) => s.status);
  const animating = useGame((s) => s.animating);
  const myTurn = status === 'playing' && !animating && (me === 'both' || me === turn);
  return (
    <div className="pe-auto" style={{ position: 'absolute', left: 18, top: 110, width: 270, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <section className="panel">
        <div className="panel-head"><h3>Abilities</h3><span className="chip cyan">War Chess</span></div>
        <div className="panel-body col" style={{ gap: 6 }}>
          {view.own.map((a) => {
            const def = ABILITIES_BY_ID[a.id];
            const selecting = ability?.id === a.id;
            return (
              <button key={a.id} title={def.description}
                disabled={def.kind === 'passive' || !a.usable || !myTurn}
                onClick={() => (selecting ? GameController.cancelAbility() : GameController.beginAbility(a.id))}
                className="list-item" style={{ textAlign: 'left', color: 'inherit', border: `1px solid ${selecting ? 'var(--cyan)' : 'rgba(232,162,58,0.12)'}`, background: selecting ? 'rgba(57,208,255,0.12)' : 'transparent', cursor: def.kind === 'active' && a.usable && myTurn ? 'pointer' : 'default', opacity: def.kind === 'passive' || (a.usable && myTurn) ? 1 : 0.5 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row between"><b className="truncate">{def.name}</b>
                    {def.kind === 'passive' ? <span className="chip violet">passive</span> : <span className="chip cyan">{a.cooldown ? `cd ${a.cooldown}` : `${a.charges}×`}</span>}</div>
                  <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.25 }}>{selecting ? 'Choose a highlighted square · Esc to cancel' : def.description.slice(0, 92) + (def.description.length > 92 ? '…' : '')}</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>Enemy intel</h3></div>
        <div className="panel-body col" style={{ gap: 4 }}>
          {view.enemy.map((e, i) => e.id
            ? <div key={i} className="row between" style={{ fontSize: 13 }}><span>{ABILITIES_BY_ID[e.id].name}</span><span className="chip">{ABILITIES_BY_ID[e.id].kind}</span></div>
            : <div key={i} className="row between faint" style={{ fontSize: 13 }}><span>??? Unknown ability</span><span className="chip">secret</span></div>)}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------- centre layer: banners, combat label, countdown
function CenterLayer() {
  const banner = useGame((s) => s.banner);
  const combat = useGame((s) => s.combatLabel);
  const animating = useGame((s) => s.animating);
  const status = useGame((s) => s.status);
  const startsAt = useGame((s) => s.startsAt);
  const cinematic = useGame((s) => s.cinematic);
  const kind = useGame((s) => s.kind);
  const now = useNow(150);
  const showBanner = banner && now - banner.at < 2200;
  const countdown = status === 'countdown' ? Math.max(0, Math.ceil((startsAt - now) / 1000)) : null;
  return (
    <>
      {(showBanner || countdown !== null) && (
        <div className="pe-none" style={{ position: 'absolute', top: '24%', left: 0, right: 0, textAlign: 'center' }}>
          {countdown !== null ? (
            <><div className="eyebrow">Board resetting</div><div style={{ fontFamily: 'var(--font-head)', fontSize: 110, color: 'var(--amber-hi)', textShadow: '0 0 40px rgba(232,162,58,0.5), 0 4px 0 #000', lineHeight: 1 }}>{countdown || 'FIGHT'}</div></>
          ) : (
            <div key={banner!.at} style={{ animation: 'screen-in 0.3s ease both' }}>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 54, letterSpacing: '0.12em', textTransform: 'uppercase', textShadow: '0 4px 0 #000, 0 0 30px rgba(232,162,58,0.45)' }}>{banner!.text}</div>
              {banner!.sub && <div className="eyebrow">{banner!.sub}</div>}
            </div>
          )}
        </div>
      )}
      {(combat || cinematic) && kind !== 'demo' && (
        <div className="pe-auto" style={{ position: 'absolute', bottom: 92, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
          {combat && <div className="panel" style={{ padding: '6px 18px', marginBottom: 6 }}>
            <span className="eyebrow">{combat.attacker}</span> <b style={{ fontFamily: 'var(--font-head)', letterSpacing: '0.08em', textTransform: 'uppercase' }}> · {combat.finisher}</b>
          </div>}
          {animating && <Btn size="small" variant="ghost" onClick={() => GameController.skip()}>Skip <span className="key">SPACE</span></Btn>}
        </div>
      )}
    </>
  );
}

function PromotionPicker({ color }: { color: Color }) {
  return (
    <div className="modal-back pe-auto">
      <section className="panel" style={{ padding: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Promote to</div>
        <div className="row" style={{ gap: 10 }}>
          {(['q', 'r', 'b', 'n'] as PieceType[]).map((p) => (
            <button key={p} className="btn big" style={{ fontSize: 34, width: 76, height: 76, color: color === 'w' ? 'var(--white-side)' : 'var(--black-side)' }} onClick={() => GameController.choosePromotion(p)}>{PIECE_GLYPH[p]}</button>
          ))}
        </div>
        <button className="btn small ghost block" style={{ marginTop: 10 }} onClick={() => GameController.choosePromotion(null)}>Cancel</button>
      </section>
    </div>
  );
}

function ResultCard({ onLeave }: { onLeave: () => void }) {
  const g = useGame();
  const r = g.result!;
  const mine = g.me === 'w' || g.me === 'b' ? g.me : null;
  const title = r.reason === 'aborted' ? 'Aborted' : r.winner === null ? 'Draw' : mine ? (r.winner === mine ? 'Victory' : 'Defeat') : `${g.players[r.winner].name} wins`;
  const color = r.winner === null ? 'var(--text)' : mine && r.winner !== mine ? 'var(--red)' : 'var(--amber-hi)';
  const rematchPending = g.rematchOffers.length > 0;
  return (
    <div className="pe-auto" style={{ position: 'absolute', left: '50%', top: '18%', transform: 'translateX(-50%)', animation: 'screen-in 0.6s ease both' }}>
      <section className="panel" style={{ width: 460, textAlign: 'center' }}>
        <div className="hazard" />
        <div className="panel-body col" style={{ gap: 10, alignItems: 'center', padding: 24 }}>
          <div className="eyebrow">{REASON[r.reason] ?? r.reason}</div>
          <div style={{ fontFamily: 'var(--font-head)', fontSize: 64, letterSpacing: '0.14em', textTransform: 'uppercase', color, textShadow: '0 4px 0 #000, 0 0 40px rgba(0,0,0,0.5)', lineHeight: 1 }}>{title}</div>
          <div className="dim">{g.players.w.name} <span className="faint">vs</span> {g.players.b.name} · {g.history.length} plies · {g.captured.w.length + g.captured.b.length} fights</div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            {g.kind !== 'spectate' && g.kind !== 'replay' && g.mode !== 'kotb' && (
              <Btn variant="primary" onClick={() => GameController.rematch()}>{rematchPending && !g.rematchOffers.includes(g.me as Color) ? 'Accept rematch' : rematchPending ? 'Rematch offered…' : 'Rematch'}</Btn>
            )}
            {g.kind === 'replay' && <Btn onClick={() => GameController.replayJump(0)}>Watch again</Btn>}
            <Btn variant="ghost" onClick={onLeave}>Back to lobby</Btn>
          </div>
          {g.mode === 'kotb' && <div className="faint" style={{ fontSize: 13 }}>King of the Board: the winner holds the table. The next challenger steps up shortly.</div>}
        </div>
      </section>
    </div>
  );
}

function ReplayControls() {
  const r = useGame((s) => s.replay)!;
  const animating = useGame((s) => s.animating);
  return (
    <div className="pe-auto" style={{ position: 'absolute', bottom: 92, left: '50%', transform: 'translateX(-50%)' }}>
      <section className="panel">
        <div className="row" style={{ padding: '8px 12px', gap: 8 }}>
          <button className="icon-btn" title="Start" onClick={() => GameController.replayJump(0)}>⏮</button>
          <button className="icon-btn" title="Previous move" onClick={() => GameController.replayStep(-1)} disabled={animating}>◀</button>
          <Btn size="small" variant="primary" onClick={() => GameController.replayPlay(!r.playing)}>{r.playing ? 'Pause' : 'Play'}</Btn>
          <button className="icon-btn" title="Next move" onClick={() => GameController.replayStep(1)} disabled={animating}>▶</button>
          <button className="icon-btn" title="End" onClick={() => GameController.replayJump(r.total)}>⏭</button>
          <input type="range" min={0} max={r.total} value={r.index} onChange={(e) => GameController.replayJump(Number(e.target.value))} style={{ width: 220 }} />
          <span className="mono faint" style={{ fontSize: 12, width: 64 }}>{r.index}/{r.total}</span>
          <SpeedSelect />
        </div>
      </section>
    </div>
  );
}

function SpeedSelect() {
  const [speed, setSpeed] = useState(1);
  return (
    <select className="input" style={{ padding: '4px 8px' }} value={speed} onChange={(e) => { const v = Number(e.target.value); setSpeed(v); useSettings.getState().set({ combatSpeed: v }); }}>
      {[0.5, 1, 1.5, 2, 3].map((s) => <option key={s} value={s}>{s}×</option>)}
    </select>
  );
}

export { FactionManager };

/** Arcade: big match timer at the top centre (real time — no per-turn clocks). */
function ArcadeTimer() {
  const ends = useGame((s) => s.arcadeEndsAt);
  const status = useGame((s) => s.status);
  const now = useNow(250);
  if (!ends || status !== 'playing') return null;
  const left = Math.max(0, Math.ceil((ends - now) / 1000));
  return (
    <div className="pe-none" style={{ position: 'absolute', top: 92, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
      <div className="eyebrow">Arcade · take the king</div>
      <div className={`mono ${left <= 30 ? 'red pulse' : 'amber'}`} style={{ fontSize: 30, fontWeight: 700 }}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</div>
    </div>
  );
}
