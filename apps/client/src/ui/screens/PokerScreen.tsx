// Scrap Poker: pick a table, buy in with a whole robot, and play Texas Hold'em
// against other players and bots. Lose chips and your robot is stripped for
// parts; leave and your stack goes back to your credit bank.

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { PokerView, PokerSeatView } from '@ashen/shared';
import { NetworkManager } from '../../core/NetworkManager';
import { useApp } from '../../core/store';
import { usePokerLayout } from '../../game/poker/PokerStage';
import { Btn, Panel, useNow } from '../common';
import { TopBar } from '../TopBar';

export const usePoker = create<{ view: PokerView | null; offset: number; set(v: PokerView | null): void }>((set) => ({
  view: null, offset: 0,
  set: (v) => set({ view: v, offset: v ? v.serverNow - Date.now() : 0 }),
}));

const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
function CardFace({ card, size = 1 }: { card: string | null; size?: number }) {
  const w = 44 * size, h = 62 * size;
  if (!card) return <div style={{ width: w, height: h, borderRadius: 6, background: 'repeating-linear-gradient(45deg,#6a2a20,#6a2a20 6px,#4a1c16 6px,#4a1c16 12px)', border: '2px solid #e8dcc0', boxShadow: '0 3px 8px rgba(0,0,0,0.5)' }} />;
  const red = card[1] === 'h' || card[1] === 'd';
  const rank = card[0] === 'T' ? '10' : card[0];
  return (
    <div style={{ width: w, height: h, borderRadius: 6, background: '#f6f0e2', color: red ? '#b8261c' : '#161210', border: '1px solid #c8bca0', boxShadow: '0 3px 8px rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-head)', lineHeight: 1 }}>
      <div style={{ textAlign: 'center' }}><div style={{ fontSize: 20 * size, fontWeight: 700 }}>{rank}</div><div style={{ fontSize: 20 * size }}>{SUIT[card[1]]}</div></div>
    </div>
  );
}

export function PokerScreen() {
  const go = useApp((s) => s.go);
  const lobby = useApp((s) => s.lobby);
  const profile = useApp((s) => s.profile);
  const view = usePoker((s) => s.view);
  const connection = useApp((s) => s.connection);
  const [watching, setWatching] = useState<string | null>(null);

  useEffect(() => NetworkManager.on('poker:state', (v) => usePoker.getState().set(v)), [connection]);
  useEffect(() => {
    if (!watching || connection !== 'online') return;
    void NetworkManager.call('poker:watch', { tableId: watching, on: true }, { quiet: true }).then((v) => usePoker.getState().set(v as PokerView)).catch(() => {});
    return () => { void NetworkManager.call('poker:watch', { tableId: watching, on: false }, { quiet: true }).catch(() => {}); };
  }, [watching, connection]);
  useEffect(() => () => usePoker.getState().set(null), []);

  const join = async (tableId: string) => {
    try {
      const v = await NetworkManager.call('poker:join', { tableId }) as PokerView;
      usePoker.getState().set(v);
      setWatching(tableId);
    } catch { /* toast shown */ }
  };
  const leave = async () => {
    if (!view) return;
    await NetworkManager.call('poker:leave', { tableId: view.tableId }).catch(() => {});
  };

  const seated = view?.you !== null && view?.you !== undefined;
  return (
    <div className="screen pe-none">
      <div className="pe-auto"><TopBar back={() => { void leave(); setWatching(null); go('lobby'); }} title="Scrap Poker" /></div>
      {!watching && (
        <div className="pe-auto" style={{ position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', width: 'min(640px, calc(100vw - 32px))' }}>
          <Panel title="Scrap Poker · Texas Hold'em" right={<span className="mono amber">{(profile?.credits ?? 0).toLocaleString()} cr</span>}>
            <div className="faint" style={{ fontSize: 13, marginBottom: 10 }}>
              Buy in with a whole robot. Every chip you lose strips a part off it, and every part you take from others piles up beside you.
              Leave the table any time to turn your stack back into bank credits for the Derby.
            </div>
            <div className="col" style={{ gap: 8 }}>
              {(lobby?.poker ?? []).map((t) => (
                <div key={t.id} className="list-item" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', padding: 10 }}>
                  <div className="col" style={{ gap: 2 }}>
                    <b style={{ fontFamily: 'var(--font-head)', fontSize: 18 }}>{t.name}</b>
                    <span className="faint" style={{ fontSize: 12 }}>Blinds {t.sb}/{t.bb} · buy-in {t.buyIn} cr (10 parts × {t.buyIn / 10}) · {t.humans} player{t.humans === 1 ? '' : 's'}{t.players.length ? `: ${t.players.slice(0, 5).join(', ')}` : ''}</span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <Btn size="small" variant="ghost" onClick={() => setWatching(t.id)}>Watch</Btn>
                    <Btn size="small" variant="primary" disabled={(profile?.credits ?? 0) < t.buyIn} onClick={() => void join(t.id)}>Sit down</Btn>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
      {watching && view && <TableLayer view={view} seated={seated} onSit={() => void join(view.tableId)} onLeave={() => void leave()} onBack={() => setWatching(null)} />}
    </div>
  );
}

function TableLayer({ view, seated, onSit, onLeave, onBack }: { view: PokerView; seated: boolean; onSit: () => void; onLeave: () => void; onBack: () => void }) {
  const layout = usePokerLayout();
  const offset = usePoker((s) => s.offset);
  const now = useNow(200);
  const me = view.you !== null ? view.seats[view.you] : null;
  const myTurn = !!view.options && view.toAct === view.you;
  const left = Math.max(0, Math.ceil((view.deadline - (now + offset)) / 1000));
  return (
    <>
      {/* Seats */}
      {view.seats.map((s, i) => s && layout.seats[i] && <SeatTag key={s.id} s={s} pos={layout.seats[i]!} view={view} acting={view.toAct === i} left={left} />)}
      {/* Board + pot */}
      <div className="pe-none" style={{ position: 'absolute', left: layout.center.x, top: layout.center.y, transform: 'translate(-50%, -60%)', textAlign: 'center' }}>
        <div className="row" style={{ gap: 6, justifyContent: 'center' }}>{[0, 1, 2, 3, 4].map((k) => view.board[k] ? <CardFace key={k} card={view.board[k]} /> : <div key={k} style={{ width: 44, height: 62, borderRadius: 6, border: '1px dashed rgba(255,255,255,0.15)' }} />)}</div>
        <div className="chip amber" style={{ marginTop: 8, fontSize: 14 }}>Pot {view.pot}</div>
        {view.street === 'showdown' && view.result && (
          <div style={{ marginTop: 8, padding: '6px 12px', background: 'rgba(12,10,8,0.85)', borderRadius: 8, border: '1px solid var(--amber)' }}>
            {view.result.winners.map((w) => <div key={w.seat}><b className="amber">{view.seats[w.seat]?.name}</b> takes {w.amount}{w.hand ? ` with ${w.hand}` : ''}</div>)}
          </div>
        )}
      </div>
      {/* Controls */}
      <div className="pe-auto" style={{ position: 'absolute', left: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 8, width: 260 }}>
        <Panel title={view.name} right={<span className="faint mono" style={{ fontSize: 11 }}>{view.sb}/{view.bb}</span>}>
          <div className="col" style={{ gap: 2, fontSize: 11, maxHeight: 130, overflow: 'auto' }}>
            {view.log.map((l, i) => <div key={i} className="faint">{l}</div>)}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            {seated ? <Btn size="small" onClick={onLeave}>Cash out & leave</Btn> : <Btn size="small" variant="primary" onClick={onSit}>Sit down ({view.buyIn} cr)</Btn>}
            {!seated && <Btn size="small" variant="ghost" onClick={onBack}>Tables</Btn>}
          </div>
        </Panel>
      </div>
      {me && myTurn && view.options && <ActionBar view={view} left={left} />}
      {me && !myTurn && view.street !== 'waiting' && (
        <div className="pe-none" style={{ position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)' }}>
          <span className="chip">{me.folded ? 'Folded — watch your robot sweat' : view.street === 'showdown' ? 'Next hand soon…' : `Waiting for ${view.seats[view.toAct]?.name ?? '…'}`}</span>
        </div>
      )}
      {view.street === 'waiting' && <div className="pe-none" style={{ position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)' }}><span className="chip">{seated ? 'Shuffling up…' : 'Waiting for players'}</span></div>}
    </>
  );
}

function SeatTag({ s, pos, view, acting, left }: { s: PokerSeatView; pos: { x: number; y: number }; view: PokerView; acting: boolean; left: number }) {
  const showdown = view.street === 'showdown';
  return (
    <div className="pe-none" style={{ position: 'absolute', left: pos.x, top: pos.y, transform: 'translate(-50%, -100%)', textAlign: 'center', minWidth: 120 }}>
      {s.cards && s.cards.length > 0 && <div className="row" style={{ gap: 3, justifyContent: 'center', marginBottom: 4 }}>{s.cards.map((c, i) => <CardFace key={i} card={c} size={s.you ? 0.9 : 0.62} />)}</div>}
      {s.cards === null && <div className="row" style={{ gap: 3, justifyContent: 'center', marginBottom: 4 }}><CardFace card={null} size={0.5} /><CardFace card={null} size={0.5} /></div>}
      <div style={{ background: 'rgba(12,10,8,0.82)', border: `1px solid ${acting ? 'var(--amber)' : s.you ? 'rgba(232,162,58,0.5)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 8, padding: '4px 10px', opacity: s.folded && !showdown ? 0.55 : 1 }}>
        <div className="row" style={{ gap: 6, justifyContent: 'center' }}><b style={{ fontSize: 13 }}>{s.you ? 'You' : s.name}</b>{s.bot && <span className="faint" style={{ fontSize: 9 }}>BOT</span>}</div>
        <div className="mono" style={{ fontSize: 12 }}><span className="amber">{s.stack}</span> · <span title="robot parts left">⚙{s.parts}/10</span>{s.scrap > 0 && <span className="green" title="scrap won"> +{s.scrap}</span>}</div>
        {s.lastAction && <div className="faint" style={{ fontSize: 10 }}>{s.allIn ? 'ALL IN' : s.lastAction}</div>}
        {acting && <div style={{ height: 3, background: 'var(--amber)', width: `${Math.min(100, left * 4)}%`, marginTop: 3, borderRadius: 2 }} />}
      </div>
      {s.bet > 0 && <div className="chip" style={{ marginTop: 3, fontSize: 10 }}>bet {s.bet}</div>}
    </div>
  );
}

function ActionBar({ view, left }: { view: PokerView; left: number }) {
  const o = view.options!;
  const [amount, setAmount] = useState(o.minRaiseTo);
  useEffect(() => setAmount(o.minRaiseTo), [o.minRaiseTo, view.handNo]);
  const act = (action: 'fold' | 'check' | 'call' | 'raise' | 'allin', amt?: number) => void NetworkManager.call('poker:act', { tableId: view.tableId, action, amount: amt }).catch(() => {});
  const canRaise = o.maxRaiseTo > o.toCall + (view.seats[view.you!]?.bet ?? 0);
  const pot = view.pot;
  return (
    <div className="pe-auto" style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(12,10,8,0.9)', border: '1px solid var(--amber)', borderRadius: 12, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', maxWidth: 'calc(100vw - 32px)' }}>
      <span className="mono amber" style={{ fontSize: 13 }}>{left}s</span>
      <Btn onClick={() => act('fold')}>Fold</Btn>
      {o.canCheck ? <Btn variant="primary" onClick={() => act('check')}>Check</Btn> : <Btn variant="primary" onClick={() => act('call')}>Call {o.toCall}</Btn>}
      {canRaise && (
        <>
          <input type="range" min={o.minRaiseTo} max={o.maxRaiseTo} step={view.bb / 2} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: 140 }} />
          <button className="btn small ghost" onClick={() => setAmount(Math.min(o.maxRaiseTo, Math.max(o.minRaiseTo, Math.round(pot / 2))))}>½ pot</button>
          <button className="btn small ghost" onClick={() => setAmount(Math.min(o.maxRaiseTo, Math.max(o.minRaiseTo, pot)))}>Pot</button>
          <Btn onClick={() => act(amount >= o.maxRaiseTo ? 'allin' : 'raise', amount)}>{amount >= o.maxRaiseTo ? `All in ${amount}` : `Raise to ${amount}`}</Btn>
        </>
      )}
    </div>
  );
}
