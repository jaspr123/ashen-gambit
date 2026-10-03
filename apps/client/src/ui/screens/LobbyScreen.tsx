import type React from 'react';
// Multiplayer lobby: live arenas (watch any match), King-of-the-Board tables
// with champion + challenger queue, the quick-match queue, online players with
// status, and every way into a game.

import { useMemo, useState } from 'react';
import { GAME_MODES, timeControlLabel, type ArenaSnapshot, type LobbySnapshot, type MatchSummary, type PublicPlayer } from '@ashen/shared';
import { NetworkManager } from '../../core/NetworkManager';
import { useApp } from '../../core/store';
import { Avatar, Btn, FactionBadge, Modal, Panel, Seg, StatusDot, useNow } from '../common';
import { TopBar } from '../TopBar';

export function LobbyScreen() {
  const lobby = useApp((s) => s.lobby);
  const profile = useApp((s) => s.profile);
  const queue = useApp((s) => s.queue);
  const connection = useApp((s) => s.connection);
  const go = useApp((s) => s.go);
  const [privateOpen, setPrivateOpen] = useState(false);
  const now = useNow(500);
  const offset = lobby ? Date.now() - lobby.serverNow : 0;

  const matchesByArena = useMemo(() => new Map((lobby?.matches ?? []).map((m) => [m.id, m])), [lobby]);
  const openMatches = (lobby?.matches ?? []).filter((m) => !lobby?.arenas.some((a) => a.matchId === m.id));
  const counts = useMemo(() => {
    const c = { idle: 0, queued: 0, playing: 0, spectating: 0, away: 0 };
    for (const p of lobby?.players ?? []) c[p.status]++;
    return c;
  }, [lobby]);

  const searching = queue.state === 'searching' || queue.state === 'kotb';
  const online = connection === 'online';

  return (
    <div className="screen">
      <TopBar />
      <div className="grid-3col" style={{ ['--left' as string]: '300px', ['--right' as string]: '300px' } as React.CSSProperties}>
        {/* ---------------------------------------------------- left: deploy */}
        <div className="col" style={{ gap: 14, minHeight: 0 }}>
          <Panel title="Deploy" right={<span className="chip amber">{profile?.loadout.mode ? GAME_MODES[profile.loadout.mode].name : '—'}</span>}>
            <div className="col" style={{ gap: 8 }}>
              <Seg<'standard' | 'war' | 'checkers' | 'arcade'> value={(profile?.loadout.mode === 'kotb' ? 'standard' : profile?.loadout.mode) ?? 'standard'}
                onChange={(mode) => { if (profile) void NetworkManager.call('loadout:set', { ...profile.loadout, mode }); }}
                options={[{ value: 'standard', label: 'Chess' }, { value: 'war', label: 'War' }, { value: 'arcade', label: 'Arcade' }, { value: 'checkers', label: 'Checkers' }]} />
              <Btn variant="primary" size="big" block disabled={!online || searching} onClick={() => NetworkManager.call('queue:join', { kind: 'quick' })}>Quick Match</Btn>
              <Btn block disabled={!online || searching} onClick={() => NetworkManager.call('queue:join', { kind: 'quick', mode: 'arcade' })} title="Real-time chess: no turns, piece cooldowns, fast fights">Arcade Chess</Btn>
              <Btn block disabled={!online || searching} onClick={() => NetworkManager.call('queue:join', { kind: 'quick', mode: 'checkers' })} title="Draughts with on-board fights. Joins anyone waiting for checkers.">Battle Checkers</Btn>
              <Btn block disabled={!online || searching} onClick={() => NetworkManager.call('queue:join', { kind: 'kotb' })}>King of the Board</Btn>
              <div className="grid2">
                <Btn size="small" disabled={!online} onClick={() => setPrivateOpen(true)}>Private Match</Btn>
                <Btn size="small" onClick={() => { useApp.setState({ pendingSession: 'ai' }); go('loadout'); }}>Practice vs AI</Btn>
                <Btn size="small" onClick={() => { useApp.setState({ pendingSession: 'local' }); go('loadout'); }}>Local 2-Player</Btn>
                <Btn size="small" onClick={() => { useApp.setState({ pendingSession: 'online' }); go('loadout'); }}>Loadout</Btn>
              </div>
              <div className="divider" />
              <div className="grid2">
                <Btn variant="cyan" disabled={!online} onClick={() => go('derby')} title="Bet on armed jockeys racing round the wasteland track">Wasteland Derby</Btn>
                <Btn variant="cyan" disabled={!online} onClick={() => go('poker')} title="Texas Hold'em — lose and your robot is stripped for parts">Scrap Poker</Btn>
              </div>
              <Btn variant="cyan" block onClick={() => go('army')}>Custom Army Creator</Btn>
              <div className="grid2">
                <Btn size="small" variant="ghost" onClick={() => go('profile')}>Profile</Btn>
                <Btn size="small" variant="ghost" onClick={() => go('lab')}>Combat Lab</Btn>
              </div>
            </div>
          </Panel>
          {searching && <QueueCard now={now} offset={offset} />}
          <Panel title="Quick Queue" right={<span className="chip">{lobby?.quickQueue.length ?? 0} waiting</span>} className="grow" style={{ minHeight: 0 }} bodyClass="scroll">
            {(lobby?.quickQueue ?? []).length === 0 && <div className="empty">Nobody waiting. Be the first.</div>}
            {(lobby?.quickQueue ?? []).map((q, i) => (
              <div key={q.id} className="list-item">
                <span className="mono amber" style={{ width: 18 }}>{i + 1}</span>
                <div className="col grow" style={{ gap: 0, minWidth: 0 }}>
                  <span className="truncate">{q.name}</span>
                  <span className="faint" style={{ fontSize: 10 }}>{GAME_MODES[q.mode].name} · {timeControlLabel(q.timeControl)} · {Math.floor((now - offset - q.waitingSince) / 1000)}s</span>
                </div>
                {q.id !== profile?.id && <Btn size="small" variant="cyan" disabled={!online} onClick={() => NetworkManager.call('queue:join', { kind: 'quick', withUser: q.id })}>Join</Btn>}
              </div>
            ))}
          </Panel>
        </div>

        {/* ---------------------------------------------------- centre: arenas */}
        <div className="col scroll" style={{ gap: 14, minHeight: 0, paddingRight: 4 }}>
          {!online && (
            <section className="panel"><div className="panel-body row"><span className="dot st-queued pulse" /><span>{connection === 'connecting' ? 'Connecting to the server…' : 'Server offline — practice and local games still work.'}</span></div></section>
          )}
          {lobby?.derby && <DerbyCard d={lobby.derby} now={now} offset={offset} onJoin={() => go('derby')} />}
          <div className="row between"><div className="eyebrow">Arenas · live</div><span className="faint mono" style={{ fontSize: 11 }}>{lobby?.matches.length ?? 0} matches in progress</span></div>
          {(lobby?.arenas ?? []).map((a) => <ArenaCard key={a.id} arena={a} match={a.matchId ? matchesByArena.get(a.matchId) : undefined} now={now} offset={offset} meId={profile?.id} />)}
          {openMatches.map((m, i) => <MatchCard key={m.id} match={m} label={`Pit ${i + 1}`} />)}
          {online && !lobby?.matches.length && !lobby?.arenas.some((a) => a.queue.length) && (
            <section className="panel"><div className="panel-body empty">The arenas are quiet. Queue up, or add simulated players from the dev panel (<span className="kbd">`</span>).</div></section>
          )}
        </div>

        {/* ---------------------------------------------------- right: players */}
        <Panel title="Survivors Online" right={<span className="chip green">{lobby?.players.length ?? 0}</span>} style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }} bodyClass="scroll grow">
          <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
            <span className="chip"><StatusDot status="idle" /> {counts.idle} idle</span>
            <span className="chip"><StatusDot status="queued" /> {counts.queued} waiting</span>
            <span className="chip"><StatusDot status="playing" /> {counts.playing} playing</span>
            <span className="chip"><StatusDot status="spectating" /> {counts.spectating} watching</span>
          </div>
          {(lobby?.players ?? []).map((p) => <PlayerRow key={p.id} p={p} me={p.id === profile?.id} />)}
        </Panel>
      </div>
      {privateOpen && <PrivateMatchModal onClose={() => setPrivateOpen(false)} />}
    </div>
  );
}

function DerbyCard({ d, now, offset, onJoin }: { d: NonNullable<LobbySnapshot['derby']>; now: number; offset: number; onJoin: () => void }) {
  const secs = Math.max(0, Math.ceil((d.bettingClosesAt - (now - offset)) / 1000));
  const status = d.phase === 'betting' ? `Betting open · closes in ${secs}s` : d.phase === 'results' ? 'Results are in' : 'Race in progress';
  return (
    <section className="panel">
      <div className="panel-body row between" style={{ gap: 12 }}>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}><span className="chip amber">Wasteland Derby</span><h3 className="truncate">Race {d.number} · {d.name}</h3></div>
          <span className="faint" style={{ fontSize: 12 }}>{status} · {d.watchers} track-side{d.punters.length ? `: ${d.punters.slice(0, 5).join(', ')}${d.punters.length > 5 ? '…' : ''}` : ''}</span>
        </div>
        <Btn variant="primary" onClick={onJoin}>{d.watchers ? 'Join them' : 'Go track-side'}</Btn>
      </div>
    </section>
  );
}

function QueueCard({ now, offset }: { now: number; offset: number }) {
  const q = useApp((s) => s.queue);
  const waited = q.since ? Math.floor((now - offset - q.since) / 1000) : 0;
  return (
    <section className="panel" style={{ borderColor: 'var(--amber)' }}>
      <div className="hazard" />
      <div className="panel-body col" style={{ gap: 6 }}>
        <div className="row between">
          <div className="eyebrow pulse">{q.kind === 'kotb' ? `Arena queue · position ${q.position ?? '?'}` : 'Searching for opponent'}</div>
          <span className="mono">{q.kind === 'kotb' ? '' : `${Math.floor(waited / 60)}:${String(waited % 60).padStart(2, '0')}`}</span>
        </div>
        <div className="row"><div className="spin" style={{ width: 14, height: 14, border: '2px solid var(--amber)', borderTopColor: 'transparent', borderRadius: '50%' }} /><span className="dim">{q.kind === 'kotb' ? 'Waiting for your turn at the table' : 'Matching by rating and time control'}</span></div>
        <Btn variant="ghost" size="small" onClick={() => NetworkManager.call('queue:leave', {})}>Leave queue</Btn>
      </div>
    </section>
  );
}

function ArenaCard({ arena, match, now, offset, meId }: { arena: ArenaSnapshot; match?: MatchSummary; now: number; offset: number; meId?: string }) {
  const inQueue = arena.queue.some((q) => q.id === meId);
  const countdown = arena.countdownUntil ? Math.max(0, Math.ceil((arena.countdownUntil - (now - offset)) / 1000)) : null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div className="row"><span className="chip amber">King of the Board</span><h3>{arena.name}</h3></div>
        {match ? <span className="chip red"><span className="dot st-playing pulse" /> Live · ply {match.ply}</span> : countdown !== null ? <span className="chip amber pulse">Next bout in {countdown}s</span> : <span className="chip">Waiting for challenger</span>}
      </div>
      <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 14 }}>
        <div className="col" style={{ gap: 8 }}>
          {match ? <Versus m={match} /> : <div className="dim">{arena.champion ? <>Champion <b className="amber">{arena.champion.name}</b> holds the table ({arena.champion.defenses} defenses).</> : 'The table is empty. First two challengers fight for it.'}</div>}
          <div className="row">
            {match && <Btn size="small" variant="cyan" onClick={() => NetworkManager.call('match:spectate', { matchId: match.id })}>Watch · {match.spectators}</Btn>}
            {!inQueue ? <Btn size="small" onClick={() => NetworkManager.call('queue:join', { kind: 'kotb', arenaId: arena.id })}>Challenge the table</Btn> : <Btn size="small" variant="ghost" onClick={() => NetworkManager.call('queue:leave', {})}>Leave line</Btn>}
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Challengers</div>
          {arena.queue.length === 0 && <div className="faint" style={{ fontSize: 13 }}>No one in line</div>}
          {arena.queue.slice(0, 6).map((q, i) => <div key={q.id} className="row" style={{ fontSize: 13, padding: '2px 0' }}><span className="mono amber" style={{ width: 16 }}>{i + 1}.</span><span className={`truncate ${q.id === meId ? 'amber' : ''}`}>{q.name}</span></div>)}
          {arena.queue.length > 6 && <div className="faint" style={{ fontSize: 12 }}>+{arena.queue.length - 6} more</div>}
        </div>
      </div>
    </section>
  );
}

function Versus({ m }: { m: MatchSummary }) {
  return (
    <div className="row" style={{ gap: 14 }}>
      <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
        <div className="row"><span className="dot" style={{ background: 'var(--white-side)' }} /><b className="truncate">{m.white.name}</b><span className="mono faint" style={{ fontSize: 11 }}>{m.white.rating}</span></div>
        <FactionBadge id={m.white.faction} />
      </div>
      <div style={{ fontFamily: 'var(--font-head)', color: 'var(--amber)', fontSize: 20 }}>VS</div>
      <div className="col" style={{ gap: 2, flex: 1, minWidth: 0, alignItems: 'flex-end' }}>
        <div className="row"><span className="mono faint" style={{ fontSize: 11 }}>{m.black.rating}</span><b className="truncate">{m.black.name}</b><span className="dot" style={{ background: 'var(--black-side)' }} /></div>
        <FactionBadge id={m.black.faction} />
      </div>
    </div>
  );
}

function MatchCard({ match, label }: { match: MatchSummary; label: string }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div className="row"><span className="chip">{label}</span><h3>{GAME_MODES[match.mode].name}</h3><span className="chip">{timeControlLabel(match.timeControl)}</span></div>
        <span className="chip red"><span className="dot st-playing pulse" /> {match.status === 'countdown' ? 'Starting' : `Turn ${Math.floor(match.ply / 2) + 1}`}</span>
      </div>
      <div className="panel-body row" style={{ gap: 16 }}>
        <div className="grow"><Versus m={match} /></div>
        <Btn size="small" variant="cyan" onClick={() => NetworkManager.call('match:spectate', { matchId: match.id })}>Watch · {match.spectators}</Btn>
      </div>
    </section>
  );
}

function PlayerRow({ p, me }: { p: PublicPlayer; me: boolean }) {
  const label = { idle: 'Idle', queued: 'Waiting for match', playing: 'In combat', spectating: 'Spectating', away: 'Away' }[p.status];
  return (
    <div className="list-item">
      <Avatar id={p.avatar} size={30} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}><StatusDot status={p.status} /><b className={`truncate ${me ? 'amber' : ''}`}>{p.name}</b>{p.bot && <span className="chip" style={{ fontSize: 9, padding: '0 4px' }}>sim</span>}</div>
        <div className="row faint" style={{ fontSize: 12, gap: 6 }}><span className="mono">{p.rating}</span>·<span className="truncate">{label}</span></div>
      </div>
      {!me && p.status === 'playing' && p.matchId && <button className="icon-btn" title="Watch" onClick={() => NetworkManager.call('match:spectate', { matchId: p.matchId! })}>◉</button>}
      {!me && p.status !== 'playing' && <button className="icon-btn" title="Challenge" onClick={() => NetworkManager.call('challenge:send', { targetId: p.id })}>⚔</button>}
    </div>
  );
}

function PrivateMatchModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [join, setJoin] = useState('');
  return (
    <Modal title="Private Match" onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        <div className="dim">Create a code and share it, or enter a friend's code. Private matches are unranked and hidden from the lobby, and accept custom armies that are still in progress.</div>
        {code ? (
          <div className="col" style={{ alignItems: 'center', gap: 4 }}>
            <div className="eyebrow">Your code</div>
            <div className="mono" style={{ fontSize: 40, letterSpacing: '0.3em', color: 'var(--amber-hi)' }}>{code}</div>
            <div className="dim pulse">Waiting for opponent…</div>
          </div>
        ) : (
          <Btn variant="primary" onClick={async () => { const r = await NetworkManager.call('private:create', {}) as { code: string }; setCode(r.code); }}>Create code</Btn>
        )}
        <div className="divider" />
        <div className="row">
          <input className="input grow mono" placeholder="ENTER CODE" value={join} maxLength={8} onChange={(e) => setJoin(e.target.value.toUpperCase())} />
          <Btn disabled={join.length < 4} onClick={() => NetworkManager.call('private:join', { code: join }).then(onClose)}>Join</Btn>
        </div>
      </div>
    </Modal>
  );
}
