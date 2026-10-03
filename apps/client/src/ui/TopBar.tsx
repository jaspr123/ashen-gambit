import { useApp } from '../core/store';
import { Avatar } from './common';
import { MusicButton } from './MusicPanel';

export function TopBar({ back, title }: { back?: () => void; title?: string }) {
  const profile = useApp((s) => s.profile);
  const connection = useApp((s) => s.connection);
  const latency = useApp((s) => s.latency);
  const go = useApp((s) => s.go);
  return (
    <header className="topbar">
      {back && <button className="icon-btn" onClick={back} aria-label="Back">←</button>}
      <div className="brand"><span className="logo">ASHEN <b>GAMBIT</b></span><span className="ver">v0.1 · {title ?? 'Wasteland Network'}</span></div>
      <div className="grow" />
      <span className="chip" title="Connection">
        <span className={`dot ${connection === 'online' ? 'st-idle' : connection === 'connecting' ? 'st-queued pulse' : 'st-playing'}`} style={connection === 'online' ? { background: 'var(--green)' } : undefined} />
        {connection === 'online' ? `${latency} ms` : connection}
      </span>
      {profile && (
        <button className="row" style={{ background: 'none', border: 'none', cursor: 'pointer', gap: 10 }} onClick={() => go('profile')}>
          <Avatar id={profile.avatar} size={32} />
          <div className="col" style={{ gap: 0, alignItems: 'flex-start' }}>
            <b style={{ fontSize: 15 }}>{profile.name}</b>
            <span className="mono faint" style={{ fontSize: 11 }}>{profile.rating} · {profile.stats.wins}W {profile.stats.losses}L {profile.stats.draws}D · <span className="amber">{(profile.credits ?? 0).toLocaleString()} cr</span></span>
          </div>
        </button>
      )}
      <MusicButton />
      {profile?.isAdmin && <button className="icon-btn" title="Admin" onClick={() => go('admin')}>🛠</button>}
      <button className="icon-btn" title="Settings" onClick={() => go('settings')}>⚙</button>
    </header>
  );
}
