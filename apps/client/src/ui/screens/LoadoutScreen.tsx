import type React from 'react';
// Loadout: choose army, mode, timer, ability visibility, finishers, and (for
// practice) the AI difficulty. A live 3D preview shows each piece, its
// attacks, deaths and finisher played on a real board section.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AI_LEVELS, ABILITY_VISIBILITIES, DEATH_TYPES, DEFAULT_FINISHERS, FACTIONS, FACTION_IDS, GAME_MODES, INCREMENTS, PIECE_CLASSES, TIME_MINUTES,
  abilitiesFor, finishersFor, isBuiltinFaction, isFinisherUnlocked,
  type AiLevelId, type CustomArmy, type FactionId, type FinisherSelection, type GameAction, type GameModeId, type Loadout, type PieceClass,
} from '@ashen/shared';
import { NetworkManager } from '../../core/NetworkManager';
import { useApp } from '../../core/store';
import { FactionManager } from '../../game/FactionManager';
import { GameController } from '../../game/GameController';
import { Btn, FactionBadge, Panel, Seg } from '../common';
import { PiecePreview, type PiecePreviewHandle } from '../PiecePreview';
import { TopBar } from '../TopBar';
import { GLYPHS } from '../../game/pieces/ProceduralPieceFactory';

const LOCAL_KEY = 'ashen.localLoadout';

function defaultLoadout(): Loadout {
  return { faction: 'remnants', mode: 'standard', finishers: { ...DEFAULT_FINISHERS }, timeControl: { minutes: 10, incrementSec: 0 }, abilityVisibility: 'secret' };
}

export function LoadoutScreen() {
  const profile = useApp((s) => s.profile);
  const session = useApp((s) => s.pendingSession);
  const go = useApp((s) => s.go);
  const [l, setL] = useState<Loadout>(() => profile?.loadout ?? readLocal() ?? defaultLoadout());
  const [opponent, setOpponent] = useState<FactionId>('machines');
  const [aiLevel, setAiLevel] = useState<AiLevelId>('soldier');
  const [aiColor, setAiColor] = useState<'w' | 'b'>('b');
  const [piece, setPiece] = useState<PieceClass>('knight');
  const [armies, setArmies] = useState<CustomArmy[]>([]);
  const preview = useRef<PiecePreviewHandle>(null);
  const stats = profile?.stats ?? { wins: 0, captures: 0, kingDefeats: 0 };

  useEffect(() => {
    NetworkManager.call('army:list', {}, { quiet: true }).then((r) => {
      const list = (r as (CustomArmy & { valid: boolean })[]) ?? [];
      list.forEach((a) => FactionManager.registerArmy(a));
      setArmies(list);
    }).catch(() => {});
  }, []);

  const set = (p: Partial<Loadout>) => setL((cur) => ({ ...cur, ...p }));
  const setFinisher = (pc: PieceClass, id: string) => setL((cur) => ({ ...cur, finishers: { ...cur.finishers, [pc]: id } }));
  const abilities = useMemo(() => abilitiesFor(isBuiltinFaction(l.faction) ? l.faction : FactionManager.army(l.faction)?.doctrine ?? 'remnants'), [l.faction]);
  const pieceDef = isBuiltinFaction(l.faction) ? FACTIONS[l.faction].pieces[piece] : null;

  const launch = async () => {
    writeLocal(l);
    if (session === 'ai' || session === 'local') {
      const opp: FactionId = opponent;
      const fin: FinisherSelection = { ...DEFAULT_FINISHERS };
      const factions = session === 'ai' ? (aiColor === 'b' ? { w: l.faction, b: opp } : { w: opp, b: l.faction }) : { w: l.faction, b: opp };
      const finishers = session === 'ai' ? (aiColor === 'b' ? { w: l.finishers, b: fin } : { w: fin, b: l.finishers }) : { w: l.finishers, b: l.finishers };
      GameController.startLocal({ factions, mode: l.mode === 'kotb' ? 'standard' : l.mode, timeControl: l.timeControl, finishers, visibility: l.abilityVisibility, vsAi: session === 'ai' ? { color: aiColor, level: aiLevel } : undefined });
      go('game');
      return;
    }
    try {
      const p = await NetworkManager.call('loadout:set', l);
      useApp.setState({ profile: p as never });
      useApp.getState().toast('success', 'Loadout saved');
      go('lobby');
    } catch { /* toast shown */ }
  };

  const factionOptions: FactionId[] = [...FACTION_IDS, ...armies.map((a) => `custom:${a.id}` as FactionId)];
  const actions: [GameAction, string][] = [['IDLE', 'Idle'], ['MOVE', 'Walk'], ['ATTACK_PRIMARY', 'Attack'], ['ATTACK_HEAVY', 'Heavy'], ['ATTACK_STAB', 'Thrust'], ['ATTACK_RANGED', 'Ranged'], ['HIT_HEAVY', 'Hit'], ['VICTORY', 'Victory']];
  const deaths = isBuiltinFaction(l.faction) ? FACTIONS[l.faction].pieces[piece].deaths : FactionManager.combatInfo(l.faction, piece).deaths;

  return (
    <div className="screen">
      <TopBar back={() => go('lobby')} title={session === 'ai' ? 'Practice vs AI' : session === 'local' ? 'Local 2-Player' : 'Loadout'} />
      <div className="grid-3col" style={{ ['--left' as string]: '360px', ['--right' as string]: '360px' } as React.CSSProperties}>
        {/* ---------------------------------------------------- army + rules */}
        <div className="col scroll" style={{ gap: 14, minHeight: 0 }}>
          <Panel title="Army">
            <div className="col" style={{ gap: 6 }}>
              {factionOptions.map((id) => {
                const builtin = isBuiltinFaction(id);
                const army = builtin ? null : armies.find((a) => `custom:${a.id}` === id) as (CustomArmy & { valid?: boolean }) | undefined;
                return (
                  <button key={id} onClick={() => set({ faction: id })} className="list-item" style={{ background: l.faction === id ? 'rgba(232,162,58,0.14)' : 'transparent', border: `1px solid ${l.faction === id ? 'var(--amber)' : 'transparent'}`, cursor: 'pointer', textAlign: 'left', color: 'inherit' }}>
                    <span className="faction-swatch" style={{ width: 14, height: 14, background: builtin ? FACTIONS[id].palette.accent : army?.palette.accent }} />
                    <div className="grow">
                      <b>{builtin ? FACTIONS[id].name : army?.name}</b>
                      <div className="faint" style={{ fontSize: 12 }}>{builtin ? FACTIONS[id].tagline : `Custom army · ${army?.valid ? 'validated' : 'not validated (private games only)'}`}</div>
                    </div>
                    {builtin && <span className="chip">{FACTIONS[id].identity}</span>}
                  </button>
                );
              })}
            </div>
          </Panel>
          {(session === 'ai' || session === 'local') && (
            <Panel title={session === 'ai' ? 'Enemy Army' : 'Player 2 Army'}>
              <div className="row wrap" style={{ gap: 6 }}>
                {factionOptions.map((id) => <button key={id} className={`btn small ${opponent === id ? 'primary' : 'ghost'}`} onClick={() => setOpponent(id)}>{FactionManager.displayName(id).replace('The ', '')}</button>)}
              </div>
              {session === 'ai' && (
                <div className="col" style={{ gap: 10, marginTop: 12 }}>
                  <div className="field"><label>Difficulty</label>
                    <Seg value={aiLevel} onChange={setAiLevel} options={AI_LEVELS.map((a) => ({ value: a.id, label: a.name }))} />
                  </div>
                  <div className="field"><label>You play</label>
                    <Seg value={aiColor === 'b' ? 'w' : 'b'} onChange={(v) => setAiColor(v === 'w' ? 'b' : 'w')} options={[{ value: 'w', label: 'White' }, { value: 'b', label: 'Black' }]} />
                  </div>
                </div>
              )}
            </Panel>
          )}
          <Panel title="Rules">
            <div className="col" style={{ gap: 12 }}>
              <div className="field"><label>Game mode</label>
                <Seg<GameModeId> value={l.mode} onChange={(v) => set({ mode: v })} options={(Object.keys(GAME_MODES) as GameModeId[]).filter((m) => session === 'online' || m !== 'kotb').map((m) => ({ value: m, label: GAME_MODES[m].name.replace(' Chess', '') }))} />
                <div className="faint" style={{ fontSize: 12 }}>{GAME_MODES[l.mode].description}</div>
              </div>
              <div className="field"><label>Timer</label>
                <Seg value={l.timeControl.minutes} onChange={(v) => set({ timeControl: { ...l.timeControl, minutes: v } })} options={TIME_MINUTES.map((m) => ({ value: m, label: m === 0 ? '∞' : `${m}m` }))} />
              </div>
              <div className="field"><label>Increment</label>
                <Seg value={l.timeControl.incrementSec} onChange={(v) => set({ timeControl: { ...l.timeControl, incrementSec: v } })} options={INCREMENTS.map((i) => ({ value: i, label: `+${i}s` }))} />
              </div>
              {l.mode === 'war' && (
                <div className="field"><label>Abilities</label>
                  <Seg value={l.abilityVisibility} onChange={(v) => set({ abilityVisibility: v })} options={ABILITY_VISIBILITIES.map((v) => ({ value: v, label: v }))} />
                  <div className="faint" style={{ fontSize: 12 }}>{l.abilityVisibility === 'secret' ? 'Enemy abilities stay hidden until they are revealed in play.' : l.abilityVisibility === 'visible' ? 'Both sides see every ability.' : 'Abilities disabled.'}</div>
                </div>
              )}
            </div>
          </Panel>
          {l.mode === 'war' && (
            <Panel title="War Chess Doctrine">
              {abilities.map((a) => (
                <div key={a.id} className="col" style={{ gap: 2, padding: '6px 0', borderBottom: '1px solid rgba(232,162,58,0.08)' }}>
                  <div className="row between"><b>{a.name}</b><span className={`chip ${a.kind === 'passive' ? 'violet' : 'cyan'}`}>{a.kind}{a.pieceClass ? ` · ${a.pieceClass}` : ''}{a.charges ? ` · ${a.charges}×` : ''}</span></div>
                  <div className="dim" style={{ fontSize: 13 }}>{a.description}</div>
                </div>
              ))}
            </Panel>
          )}
        </div>

        {/* ---------------------------------------------------- preview */}
        <div className="col" style={{ gap: 12, minHeight: 0 }}>
          <section className="panel" style={{ overflow: 'hidden' }}>
            <PiecePreview ref={preview} faction={l.faction} pieceClass={piece} enemyFaction={opponent === l.faction ? (l.faction === 'machines' ? 'remnants' : 'machines') : opponent} height={420} />
            <div className="row" style={{ position: 'absolute', top: 12, left: 12, gap: 6 }}>
              {PIECE_CLASSES.map((pc) => (
                <button key={pc} className={`btn small ${piece === pc ? 'primary' : 'ghost'}`} style={{ fontSize: 18, minWidth: 40 }} onClick={() => setPiece(pc)} title={pc}>{GLYPHS[pc]}</button>
              ))}
            </div>
            <div className="faint mono" style={{ position: 'absolute', top: 16, right: 16, fontSize: 11 }}>right-drag orbit · wheel zoom</div>
          </section>
          <section className="panel">
            <div className="panel-body col" style={{ gap: 10 }}>
              <div className="row between">
                <div>
                  <div className="eyebrow">{FactionManager.displayName(l.faction)} · {piece}</div>
                  <h2 style={{ fontSize: 24 }}>{pieceDef?.unitName ?? `Custom ${piece}`}</h2>
                </div>
                <FactionBadge id={l.faction} />
              </div>
              {pieceDef && <div className="dim">{pieceDef.description}</div>}
              <div className="row wrap" style={{ gap: 6 }}>
                {actions.map(([a, label]) => <Btn key={a} size="small" variant="ghost" onClick={() => preview.current?.play(a)}>{label}</Btn>)}
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="eyebrow" style={{ alignSelf: 'center' }}>Deaths</span>
                {deaths.map((d) => <Btn key={d} size="small" variant="danger" onClick={() => preview.current?.death(d)}>{DEATH_TYPES[d].label}</Btn>)}
              </div>
            </div>
          </section>
        </div>

        {/* ---------------------------------------------------- finishers */}
        <div className="col scroll" style={{ gap: 14, minHeight: 0 }}>
          <Panel title="Finishing Moves">
            {PIECE_CLASSES.map((pc) => (
              <div key={pc} className="col" style={{ gap: 6, marginBottom: 12 }}>
                <div className="row between"><span className="row"><span style={{ fontSize: 20 }}>{GLYPHS[pc]}</span><b style={{ textTransform: 'capitalize' }}>{pc === 'king' ? 'King / Victory' : pc}</b></span>
                  <button className="btn small ghost" onClick={() => { setPiece(pc); preview.current?.capture(l.finishers[pc]); }}>Preview ▶</button></div>
                <div className="col" style={{ gap: 4 }}>
                  {finishersFor(pc).map((f) => {
                    const unlocked = session !== 'online' || isFinisherUnlocked(f, stats);
                    const on = l.finishers[pc] === f.id;
                    return (
                      <button key={f.id} disabled={!unlocked} onClick={() => { setFinisher(pc, f.id); setPiece(pc); preview.current?.capture(f.id); }}
                        className="list-item" style={{ cursor: unlocked ? 'pointer' : 'not-allowed', opacity: unlocked ? 1 : 0.45, background: on ? 'rgba(232,162,58,0.12)' : 'transparent', border: `1px solid ${on ? 'var(--amber)' : 'rgba(232,162,58,0.1)'}`, color: 'inherit', textAlign: 'left' }}>
                        <span className="mono amber" style={{ width: 22 }}>0{f.slot}</span>
                        <div className="grow"><b>{f.name}</b><div className="faint" style={{ fontSize: 12 }}>{unlocked ? f.description : lockText(f.unlock)}</div></div>
                        <span className="chip">{'★'.repeat(f.spectacle)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </Panel>
          <Btn variant="primary" size="big" block onClick={launch}>{session === 'online' ? 'Save loadout' : 'Deploy'}</Btn>
        </div>
      </div>
    </div>
  );
}

function lockText(u: { wins?: number; captures?: number; kingDefeats?: number }) {
  const parts = [u.wins && `${u.wins} wins`, u.captures && `${u.captures} captures`, u.kingDefeats && `${u.kingDefeats} king defeats`].filter(Boolean);
  return `Locked — requires ${parts.join(', ')}`;
}

function readLocal(): Loadout | null { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null'); } catch { return null; } }
function writeLocal(l: Loadout) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(l)); } catch { /* ignore */ } }
