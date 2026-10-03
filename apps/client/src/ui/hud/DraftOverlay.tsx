// Pre-match draft: pick your army (and, in War Chess, a secret sabotage card)
// before the board locks. The opponent only sees whether you're locked in.

import { FACTIONS, SABOTAGE, isBuiltinFaction, type FactionId } from '@ashen/shared';
import { FactionManager } from '../../game/FactionManager';
import { GameController, useGame } from '../../game/GameController';
import { Btn, useNow } from '../common';

const ICON: Record<string, string> = { mine: '💣', bomb: '🧨', wrench: '🔧', jam: '📡' };

export function DraftOverlay() {
  const pick = useGame((s) => s.pick)!;
  const players = useGame((s) => s.players);
  const me = useGame((s) => s.me);
  const now = useNow(250);
  const mine = pick.mine;
  if (!mine || me === 'spectator' || me === 'both') return null;
  const secs = Math.max(0, Math.ceil((pick.endsAt - now) / 1000));
  const opp = players[me === 'w' ? 'b' : 'w'];

  return (
    <div className="pe-auto" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'radial-gradient(ellipse at center, rgba(10,8,6,0.55), rgba(10,8,6,0.85))', zIndex: 20 }}>
      <section className="panel" style={{ width: 'min(860px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 40px)', overflow: 'auto' }}>
        <div className="hazard" />
        <div style={{ padding: 18 }}>
          <div className="row between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div className="col" style={{ gap: 2 }}>
              <div className="eyebrow">Pre-match draft · vs {opp.name}</div>
              <h2 style={{ margin: 0 }}>Choose your army</h2>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <span className={`chip ${pick.opponentReady ? 'green' : ''}`}>{opp.name}: {pick.opponentReady ? 'locked in' : 'choosing…'}</span>
              <b className="mono amber" style={{ fontSize: 28 }}>{secs}s</b>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            {pick.allowed.map((f) => <ArmyCard key={f} id={f} selected={mine.faction === f} disabled={mine.ready} />)}
          </div>

          {pick.sabotage && (
            <>
              <div className="eyebrow" style={{ marginTop: 16 }}>Sabotage · secret until it bites</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginTop: 6 }}>
                {SABOTAGE.map((s) => {
                  const on = mine.sabotage === s.id;
                  return (
                    <button key={s.id} disabled={mine.ready} onClick={() => GameController.pickDraft({ sabotage: on ? null : s.id })} className="list-item"
                      style={{ textAlign: 'left', color: 'inherit', cursor: 'pointer', padding: 10, border: `1px solid ${on ? 'var(--cyan)' : 'rgba(255,255,255,0.08)'}`, background: on ? 'rgba(111,224,255,0.1)' : 'rgba(255,255,255,0.02)', display: 'block' }}>
                      <div className="row" style={{ gap: 6 }}><span style={{ fontSize: 18 }}>{ICON[s.icon] ?? '⚑'}</span><b>{s.name}</b></div>
                      <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{s.description}</div>
                    </button>
                  );
                })}
              </div>
              <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>Killstreaks: capture 2 pieces in a row before your opponent takes one and you earn an <b>Airstrike</b> that flattens a piece and everything around it.</div>
            </>
          )}

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
            {mine.ready
              ? <Btn onClick={() => GameController.pickDraft({ ready: false })}>Change my mind</Btn>
              : <Btn variant="primary" size="big" onClick={() => GameController.pickDraft({ ready: true })}>Lock in</Btn>}
          </div>
        </div>
      </section>
    </div>
  );
}

function ArmyCard({ id, selected, disabled }: { id: FactionId; selected: boolean; disabled: boolean }) {
  const def = isBuiltinFaction(id) ? FACTIONS[id] : null;
  const accent = FactionManager.accent(id);
  return (
    <button disabled={disabled} onClick={() => GameController.pickDraft({ faction: id })} className="list-item"
      style={{ textAlign: 'left', color: 'inherit', cursor: disabled ? 'default' : 'pointer', padding: 12, display: 'block', border: `2px solid ${selected ? accent : 'rgba(255,255,255,0.08)'}`, background: selected ? `${accent}22` : 'rgba(255,255,255,0.02)', boxShadow: selected ? `0 0 18px ${accent}55` : 'none' }}>
      <div style={{ height: 6, background: accent, borderRadius: 3, marginBottom: 8 }} />
      <b style={{ fontFamily: 'var(--font-head)', fontSize: 18, letterSpacing: '0.04em' }}>{FactionManager.displayName(id)}</b>
      {def && <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{def.tagline}</div>}
      {def && <div className="chip" style={{ fontSize: 10, marginTop: 6 }}>{def.identity}</div>}
      {!def && <div className="chip cyan" style={{ fontSize: 10, marginTop: 6 }}>custom army</div>}
    </button>
  );
}
