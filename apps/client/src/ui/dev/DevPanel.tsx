// Development control panel (toggle with ` or F9). Spawn pieces, set
// positions, force captures/checkmates, switch factions, inspect abilities,
// add simulated lobby players, test spectating, camera, FPS and latency.

import { useState } from 'react';
import { FACTION_IDS, PIECE_CLASSES, type BuiltinFactionId, type Color, type Square } from '@ashen/shared';
import { NetworkManager } from '../../core/NetworkManager';
import { useSettings } from '../../core/settings';
import { useApp } from '../../core/store';
import { AssetManager } from '../../game/AssetManager';
import { GameController, useGame } from '../../game/GameController';
import { StageHandle } from '../../scene/GameCanvas';
import { Btn, useNow } from '../common';

const PRESETS: Record<string, string> = {
  'Start': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'Capture test': 'rnbqkbnr/ppp2ppp/8/3pp3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3',
  'Mate in 1': '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
  'Promotion': '8/P5k1/8/8/8/8/6K1/8 w - - 0 1',
  'Melee': 'r3k2r/ppp2ppp/2nqbn2/3pp3/3PP3/2NQBN2/PPP2PPP/R3K2R w KQkq - 0 1',
};

export function DevPanel() {
  const g = useGame();
  const latency = useApp((s) => s.latency);
  const profile = useApp((s) => s.profile);
  useNow(500);
  const [fen, setFen] = useState(PRESETS['Capture test']);
  const [w, setW] = useState<BuiltinFactionId>('remnants');
  const [b, setB] = useState<BuiltinFactionId>('machines');
  const [spawnSq, setSpawnSq] = useState('e4');
  const [spawnCls, setSpawnCls] = useState('knight');
  const [spawnColor, setSpawnColor] = useState<Color>('w');
  const st = StageHandle.current;
  const gl = StageHandle.gl;

  const loadPosition = (f = fen) => {
    GameController.startLocal({ factions: { w, b }, mode: 'standard', timeControl: { minutes: 0, incrementSec: 0 }, finishers: { w: profile?.loadout.finishers ?? defaultFin(), b: defaultFin() } });
    setTimeout(() => {
      GameController.engine = new (GameController.engine.constructor as new (o: { fen: string }) => typeof GameController.engine)({ fen: f });
      useGame.setState({ fen: f, turn: f.split(' ')[1] as Color, history: [] });
      st?.setPosition(f);
      GameController.refreshOverlays();
    }, 300);
    useApp.getState().go('game');
  };

  return (
    <div className="panel pe-auto" style={{ position: 'fixed', left: 12, bottom: 12, width: 380, maxHeight: 'calc(100vh - 24px)', zIndex: 60, display: 'flex', flexDirection: 'column' }}>
      <div className="panel-head"><h3>Dev Console</h3><span className="chip">{StageHandle.fps} fps · {latency} ms</span><button className="icon-btn" onClick={() => useApp.setState({ devPanel: false })}>✕</button></div>
      <div className="panel-body scroll col" style={{ gap: 12, fontSize: 13 }}>
        <section className="col" style={{ gap: 6 }}>
          <div className="eyebrow">Renderer</div>
          <div className="mono faint" style={{ fontSize: 11 }}>
            draw calls {gl?.info.render.calls ?? 0} · tris {gl?.info.render.triangles ?? 0} · geos {gl?.info.memory.geometries ?? 0} · tex {gl?.info.memory.textures ?? 0}<br />
            actors {st?.actors.length ?? 0} · session {g.kind} · ply {g.history.length} · animating {String(g.animating)}
          </div>
          <div className="row wrap" style={{ gap: 4 }}>
            <Btn size="small" variant="ghost" onClick={() => useSettings.getState().set({ showFps: !useSettings.getState().showFps })}>FPS overlay</Btn>
            <Btn size="small" variant="ghost" onClick={() => st?.camera.setMode('tactical')}>Cam: tactical</Btn>
            <Btn size="small" variant="ghost" onClick={() => st?.camera.setMode('free')}>Cam: free</Btn>
            <Btn size="small" variant="ghost" onClick={() => st?.camera.setMode('showcase')}>Cam: showcase</Btn>
            <Btn size="small" variant="ghost" onClick={() => st?.camera.flip()}>Flip</Btn>
          </div>
        </section>

        <section className="col" style={{ gap: 6 }}>
          <div className="eyebrow">Factions + position</div>
          <div className="row">
            <select className="input grow" value={w} onChange={(e) => setW(e.target.value as BuiltinFactionId)}>{FACTION_IDS.map((f) => <option key={f}>{f}</option>)}</select>
            <select className="input grow" value={b} onChange={(e) => setB(e.target.value as BuiltinFactionId)}>{FACTION_IDS.map((f) => <option key={f}>{f}</option>)}</select>
          </div>
          <div className="row wrap" style={{ gap: 4 }}>{Object.entries(PRESETS).map(([k, v]) => <button key={k} className="btn small ghost" onClick={() => { setFen(v); loadPosition(v); }}>{k}</button>)}</div>
          <textarea className="input mono" rows={2} value={fen} onChange={(e) => setFen(e.target.value)} style={{ fontSize: 11 }} />
          <Btn size="small" onClick={() => loadPosition()}>Load FEN as local sandbox</Btn>
        </section>

        <section className="col" style={{ gap: 6 }}>
          <div className="eyebrow">Spawn piece (visual only)</div>
          <div className="row">
            <input className="input mono" style={{ width: 60 }} value={spawnSq} onChange={(e) => setSpawnSq(e.target.value)} />
            <select className="input" value={spawnCls} onChange={(e) => setSpawnCls(e.target.value)}>{PIECE_CLASSES.map((p) => <option key={p}>{p}</option>)}</select>
            <select className="input" value={spawnColor} onChange={(e) => setSpawnColor(e.target.value as Color)}><option value="w">white</option><option value="b">black</option></select>
            <Btn size="small" onClick={() => st?.createActor(({ pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' } as const)[spawnCls as 'pawn'], spawnColor, spawnSq as Square)}>Spawn</Btn>
          </div>
        </section>

        <section className="col" style={{ gap: 6 }}>
          <div className="eyebrow">Combat</div>
          <div className="row wrap" style={{ gap: 4 }}>
            <Btn size="small" onClick={() => useApp.getState().go('lab')}>Open Combat Laboratory</Btn>
            <Btn size="small" variant="danger" onClick={() => loadPosition(PRESETS['Mate in 1'])}>Checkmate test</Btn>
            <Btn size="small" variant="ghost" onClick={() => GameController.skip()}>Skip fight</Btn>
            <Btn size="small" variant="ghost" onClick={() => { void AssetManager.loadManifest(); location.reload(); }}>Reload models</Btn>
          </div>
        </section>

        {g.abilityView && (
          <section className="col" style={{ gap: 4 }}>
            <div className="eyebrow">Ability state</div>
            <pre className="mono" style={{ fontSize: 10, margin: 0, whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto', background: 'rgba(0,0,0,0.3)', padding: 6 }}>{JSON.stringify({ own: g.abilityView.own, effects: g.abilityView.effects.map((e) => `${e.owner}:${e.kind}@${e.squares.join(',')}→${e.expiresAtPly}`) }, null, 1)}</pre>
          </section>
        )}

        <section className="col" style={{ gap: 6 }}>
          <div className="eyebrow">Multiplayer simulation</div>
          <div className="row wrap" style={{ gap: 4 }}>
            <Btn size="small" onClick={() => NetworkManager.call('dev:bots', { action: 'add', count: 4 })}>+4 simulated players</Btn>
            <Btn size="small" onClick={() => NetworkManager.call('dev:bots', { action: 'match' }).then((r) => NetworkManager.call('match:spectate', { matchId: (r as { matchId: string }).matchId }))}>Bot match → spectate</Btn>
            <Btn size="small" variant="danger" onClick={() => NetworkManager.call('dev:bots', { action: 'clear' })}>Clear bots</Btn>
          </div>
          <div className="row wrap" style={{ gap: 4 }}>
            <Btn size="small" variant="ghost" onClick={() => GameController.resync()}>Force resync</Btn>
            <Btn size="small" variant="ghost" onClick={() => { NetworkManager.socket?.disconnect(); setTimeout(() => NetworkManager.socket?.connect(), 3000); }}>Simulate 3s disconnect</Btn>
          </div>
        </section>
      </div>
    </div>
  );
}

function defaultFin() { return { pawn: 'pawn_f1', knight: 'knight_f1', bishop: 'bishop_f1', rook: 'rook_f1', queen: 'queen_f1', king: 'king_f1' }; }
