// Top-bar music control: what's playing, transport, shuffle, and the shared
// playlist (pick a track, hide ones you don't want). Admins curate the list.

import { useState } from 'react';
import { useMusic } from '../core/music';
import { useApp } from '../core/store';

export function MusicButton() {
  const [open, setOpen] = useState(false);
  const playing = useMusic((s) => s.playing);
  const current = useMusic((s) => s.tracks.find((t) => t.id === s.current));
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" title={current ? `${current.title} — ${current.artist}` : 'Music'} onClick={() => setOpen((o) => !o)}
        style={{ color: playing ? 'var(--amber)' : undefined }}>♪</button>
      {open && <MusicPanel onClose={() => setOpen(false)} />}
    </div>
  );
}

function MusicPanel({ onClose }: { onClose: () => void }) {
  const m = useMusic();
  const isAdmin = useApp((s) => s.profile?.isAdmin);
  const go = useApp((s) => s.go);
  const current = m.tracks.find((t) => t.id === m.current);
  return (
    <section className="panel" style={{ position: 'absolute', right: 0, top: 44, width: 340, zIndex: 50, boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }}>
      <div className="panel-head"><h3>Music</h3><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="panel-body col" style={{ gap: 10 }}>
        <div className="seg">
          <button className={m.source === 'playlist' ? 'on' : ''} onClick={() => m.setSource('playlist')}>Playlist</button>
          <button className={m.source === 'ambient' ? 'on' : ''} onClick={() => m.setSource('ambient')}>Game score</button>
        </div>
        {m.source === 'playlist' && (
          <>
            <div className="col" style={{ gap: 2 }}>
              <b className="truncate">{current ? current.title : m.tracks.length ? 'Nothing playing' : 'The playlist is empty'}</b>
              <span className="faint" style={{ fontSize: 12 }}>{current ? current.artist : m.tracks.length ? 'Pick a track below' : isAdmin ? 'Upload tracks in the Admin screen.' : 'An admin hasn’t added any music yet.'}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn small ghost" onClick={() => m.next(-1)} disabled={!m.tracks.length}>⏮</button>
              <button className="btn small" onClick={() => m.toggle()} disabled={!m.tracks.length}>{m.playing ? '⏸ Pause' : '▶ Play'}</button>
              <button className="btn small ghost" onClick={() => m.next(1)} disabled={!m.tracks.length}>⏭</button>
              <button className={`btn small ${m.shuffle ? '' : 'ghost'}`} onClick={() => m.setShuffle(!m.shuffle)} title="Shuffle">🔀</button>
            </div>
            <div className="scroll" style={{ maxHeight: 260 }}>
              {m.tracks.map((t) => {
                const hidden = m.hidden.includes(t.id);
                return (
                  <div key={t.id} className="list-item" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center', padding: '5px 8px', opacity: hidden ? 0.45 : 1, border: `1px solid ${t.id === m.current ? 'var(--amber)' : 'transparent'}` }}>
                    <button onClick={() => m.play(t.id)} disabled={hidden} style={{ textAlign: 'left', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: 13 }}>{t.id === m.current && m.playing ? '♪ ' : ''}{t.title}</div>
                      <div className="faint truncate" style={{ fontSize: 11 }}>{t.artist}</div>
                    </button>
                    <button className="btn small ghost" title={hidden ? 'Allow this track' : 'Never play this track for me'} onClick={() => m.toggleHidden(t.id)}>{hidden ? 'Allow' : 'Skip'}</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className="faint" style={{ fontSize: 11 }}>Volume follows Settings → Audio → Music.</div>
        {isAdmin && <button className="btn small ghost" onClick={() => { onClose(); go('admin'); }}>Manage playlist (admin)</button>}
      </div>
    </section>
  );
}
