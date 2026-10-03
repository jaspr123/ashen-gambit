import type React from 'react';
import { useEffect, useState } from 'react';
import { ACHIEVEMENTS, FACTIONS, isBuiltinFaction, type GameHistoryEntry, type ReplayData } from '@ashen/shared';
import { NetworkManager } from '../../core/NetworkManager';
import { useApp } from '../../core/store';
import { GameController } from '../../game/GameController';
import { AVATAR_GLYPHS, Avatar, Btn, FactionBadge, Panel } from '../common';
import { TopBar } from '../TopBar';

interface LeaderRow { id: string; name: string; avatar: string; rating: number; wins: number; losses: number; draws: number }

export function ProfileScreen() {
  const profile = useApp((s) => s.profile);
  const go = useApp((s) => s.go);
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [name, setName] = useState(profile?.name ?? '');

  useEffect(() => {
    NetworkManager.call('history:list', { limit: 30 }, { quiet: true }).then((r) => setHistory(r as GameHistoryEntry[])).catch(() => {});
    NetworkManager.call('leaderboard:get', {}, { quiet: true }).then((r) => setLeaders(r as LeaderRow[])).catch(() => {});
  }, []);

  if (!profile) return <div className="screen"><TopBar back={() => go('lobby')} /><div className="empty">Not signed in.</div></div>;
  const s = profile.stats;
  const winPct = s.gamesPlayed ? Math.round((s.wins / s.gamesPlayed) * 100) : 0;
  const favorite = Object.entries(s.factionGames).sort((a, b) => b[1] - a[1])[0]?.[0];
  const mostUsed = Object.entries(s.pieceCaptures).sort((a, b) => b[1] - a[1])[0];
  const pieceNames: Record<string, string> = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

  const watch = async (id: string) => {
    const data = await NetworkManager.call('replay:get', { gameId: id }) as ReplayData;
    await GameController.startReplay(data);
    go('replay');
  };

  const stat = (label: string, value: string | number, accent?: string) => (
    <div className="col" style={{ gap: 0, padding: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(232,162,58,0.1)' }}>
      <span className="eyebrow" style={{ fontSize: 9.5 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-head)', fontSize: 26, color: accent }}>{value}</span>
    </div>
  );

  return (
    <div className="screen">
      <TopBar back={() => go('lobby')} title="Service record" />
      <div className="grid-3col" style={{ ['--left' as string]: 'minmax(0,1fr)', ['--right' as string]: '340px' } as React.CSSProperties}>
        <div className="col scroll" style={{ gap: 14, minHeight: 0 }}>
          <AccountPanel hasPassword={profile.hasPassword} />
          <Panel title="Identity">
            <div className="row" style={{ gap: 14 }}>
              <Avatar id={profile.avatar} size={64} />
              <div className="col grow" style={{ gap: 6 }}>
                <div className="row"><input className="input grow" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
                  <Btn size="small" disabled={name === profile.name} onClick={() => NetworkManager.call('profile:update', { name }).then((p) => useApp.setState({ profile: p as never }))}>Rename</Btn></div>
                <div className="row wrap" style={{ gap: 4 }}>
                  {Object.entries(AVATAR_GLYPHS).map(([k, g]) => (
                    <button key={k} className="icon-btn" style={{ borderColor: profile.avatar === k ? 'var(--amber)' : undefined }} onClick={() => NetworkManager.call('profile:update', { avatar: k }).then((p) => useApp.setState({ profile: p as never }))}>{g}</button>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
          <Panel title="Statistics" right={<span className="chip amber">Rating {profile.rating}</span>}>
            <div className="grid3">
              {stat('Wins', s.wins, 'var(--green)')}{stat('Losses', s.losses, 'var(--red)')}{stat('Draws', s.draws)}
              {stat('Win %', `${winPct}%`)}{stat('Current streak', s.currentStreak, 'var(--amber-hi)')}{stat('Longest streak', s.longestStreak)}
              {stat('Games played', s.gamesPlayed)}{stat('Captures', s.captures)}{stat('King defeats', s.kingDefeats)}
              {stat('Finishers used', s.finishersUsed)}{stat('Custom armies', s.customArmies)}{stat('KotB defenses', s.kotbDefenses)}
            </div>
            <div className="row wrap" style={{ gap: 14, marginTop: 12 }}>
              <span className="dim">Favourite army: {favorite ? <FactionBadge id={favorite as never} /> : '—'}</span>
              <span className="dim">Most-used piece: <b>{mostUsed ? `${pieceNames[mostUsed[0]]} (${mostUsed[1]} captures)` : '—'}</b></span>
            </div>
          </Panel>
          <Panel title="Achievements" right={<span className="chip">{profile.achievements.length}/{ACHIEVEMENTS.length}</span>}>
            <div className="grid2">
              {ACHIEVEMENTS.map((a) => {
                const got = profile.achievements.includes(a.id);
                return (
                  <div key={a.id} className="row" style={{ gap: 10, opacity: got ? 1 : 0.4 }}>
                    <div className="avatar" style={{ borderColor: got ? 'var(--amber)' : undefined }}>{a.icon}</div>
                    <div className="col" style={{ gap: 0 }}><b>{a.name}</b><span className="faint" style={{ fontSize: 12 }}>{a.description}</span></div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
        <Panel title="Match history" style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }} bodyClass="scroll grow">
          {history.length === 0 && <div className="empty">No completed matches yet.</div>}
          {history.map((h) => {
            const myColor = h.white.id === profile.id ? 'w' : 'b';
            const outcome = h.result.winner === null ? 'Draw' : h.result.winner === myColor ? 'Win' : 'Loss';
            const opp = myColor === 'w' ? h.black : h.white;
            return (
              <div key={h.id} className="list-item">
                <span className={`chip ${outcome === 'Win' ? 'green' : outcome === 'Loss' ? 'red' : ''}`} style={{ width: 52, justifyContent: 'center' }}>{outcome}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="truncate">vs <b>{opp.name}</b> <span className="faint">({isBuiltinFaction(opp.faction) ? FACTIONS[opp.faction].name : 'Custom'})</span></div>
                  <div className="faint mono" style={{ fontSize: 11 }}>{h.mode} · {h.result.reason} · {h.plies} plies · {new Date(h.endedAt).toLocaleString()}</div>
                </div>
                <Btn size="small" variant="ghost" onClick={() => watch(h.id)}>Replay</Btn>
              </div>
            );
          })}
        </Panel>
        <Panel title="Leaderboard" style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }} bodyClass="scroll grow">
          {leaders.length === 0 && <div className="empty">No ranked games yet.</div>}
          {leaders.map((l, i) => (
            <div key={l.id} className="list-item">
              <span className="mono amber" style={{ width: 22 }}>{i + 1}</span>
              <Avatar id={l.avatar} size={28} />
              <b className={`grow truncate ${l.id === profile.id ? 'amber' : ''}`}>{l.name}</b>
              <span className="mono">{l.rating}</span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

/** Protect a guest identity with a password (or change it), and log out of this device. */
function AccountPanel({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const p = await NetworkManager.call('account:password', { password: pw, current: hasPassword ? current : undefined });
      useApp.setState({ profile: p as never });
      useApp.getState().toast('success', hasPassword ? 'Password changed.' : 'Account secured. Log in with your callsign and password on any device.');
      setPw(''); setCurrent('');
    } catch { /* toast shown */ } finally { setBusy(false); }
  };
  return (
    <Panel title="Account" right={<span className={`chip ${hasPassword ? 'green' : 'amber'}`}>{hasPassword ? 'secured' : 'guest'}</span>}>
      <div className="col" style={{ gap: 8 }}>
        {!hasPassword && <div className="faint" style={{ fontSize: 12 }}>This guest identity only lives on this device. Set a password to log in anywhere and keep your record.</div>}
        <div className="row wrap" style={{ gap: 6 }}>
          {hasPassword && <input className="input" type="password" placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} style={{ flex: 1, minWidth: 140 }} />}
          <input className="input" type="password" placeholder={hasPassword ? 'New password' : 'Password (8+ characters)'} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
          <Btn size="small" variant="primary" disabled={busy || pw.length < 8 || (hasPassword && !current)} onClick={() => void save()}>{hasPassword ? 'Change' : 'Secure account'}</Btn>
        </div>
        <AdminClaim />
        <div><Btn size="small" variant="ghost" onClick={() => { void NetworkManager.logout().then(() => location.reload()); }}>Log out of this device</Btn></div>
      </div>
    </Panel>
  );
}

/** Enter the server's admin code to unlock the Admin screen for this account. */
function AdminClaim() {
  const isAdmin = useApp((s) => s.profile?.isAdmin);
  const [code, setCode] = useState('');
  if (isAdmin) return <div className="faint" style={{ fontSize: 12 }}>You are an admin — the 🛠 button in the top bar opens the Admin screen.</div>;
  return (
    <details>
      <summary className="faint" style={{ fontSize: 12, cursor: 'pointer' }}>Admin access</summary>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <input className="input grow" type="password" placeholder="Admin code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Btn size="small" disabled={code.length < 8} onClick={() => void NetworkManager.call('account:claim-admin', { code }).then((p) => { useApp.setState({ profile: p as never }); setCode(''); useApp.getState().toast('success', 'Admin access granted.'); }).catch(() => {})}>Unlock</Btn>
      </div>
    </details>
  );
}
