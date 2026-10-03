// Admin section: curate the shared music playlist (upload, reorder, remove)
// and see a quick snapshot of the server.

import { useEffect, useRef, useState } from 'react';
import { withBase } from '../../core/base';
import { useMusic } from '../../core/music';
import { NetworkManager } from '../../core/NetworkManager';
import { describeError, useApp } from '../../core/store';
import { Btn, Panel } from '../common';
import { TopBar } from '../TopBar';

export function AdminScreen() {
  const profile = useApp((s) => s.profile);
  const go = useApp((s) => s.go);
  const tracks = useMusic((s) => s.tracks);
  const lobby = useApp((s) => s.lobby);
  const file = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  useEffect(() => { void NetworkManager.call('music:list', {}, { quiet: true }).then((t) => useMusic.getState().setTracks(t as never)).catch(() => {}); }, []);

  if (!profile?.isAdmin) {
    return (
      <div className="screen"><TopBar back={() => go('lobby')} title="Admin" />
        <div className="center grow"><Panel title="Admins only"><div className="faint">Ask for an admin code and enter it under Profile → Account → Admin access.</div></Panel></div>
      </div>
    );
  }

  const upload = async () => {
    const files = Array.from(file.current?.files ?? []);
    if (!files.length) return;
    setBusy(true);
    try {
      for (const [i, f] of files.entries()) {
        setProgress(`Uploading ${i + 1}/${files.length}: ${f.name}`);
        const name = f.name.replace(/\.[^.]+$/, '');
        const t = files.length === 1 && title.trim() ? title.trim() : name.includes(' - ') ? name.split(' - ').slice(1).join(' - ') : name;
        const a = files.length === 1 && artist.trim() ? artist.trim() : name.includes(' - ') ? name.split(' - ')[0] : artist.trim() || 'Unknown';
        const res = await fetch(withBase('/api/music'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${NetworkManager.token ?? ''}`, 'Content-Type': 'application/octet-stream', 'X-Title': encodeURIComponent(t), 'X-Artist': encodeURIComponent(a) },
          body: await f.arrayBuffer(),
        });
        const json = await res.json().catch(() => ({ ok: false, error: 'upload_failed' }));
        if (!json.ok) throw new Error(json.error);
      }
      useApp.getState().toast('success', `${files.length} track${files.length > 1 ? 's' : ''} added to the playlist`);
      setTitle(''); setArtist('');
      if (file.current) file.current.value = '';
    } catch (e) {
      useApp.getState().toast('error', describeError((e as Error).message));
    } finally { setBusy(false); setProgress(''); }
  };

  return (
    <div className="screen">
      <TopBar back={() => go('lobby')} title="Admin" />
      <div className="grid-3col" style={{ ['--left' as string]: 'minmax(0,1fr)', ['--right' as string]: '320px' } as React.CSSProperties}>
        <div className="col scroll" style={{ gap: 14, minHeight: 0 }}>
          <Panel title="Add music">
            <div className="col" style={{ gap: 8 }}>
              <input ref={file} type="file" accept="audio/*,.mp3,.ogg,.wav,.m4a,.flac" multiple className="input" />
              <div className="row" style={{ gap: 6 }}>
                <input className="input grow" placeholder="Title (single file)" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
                <input className="input grow" placeholder="Artist" value={artist} maxLength={80} onChange={(e) => setArtist(e.target.value)} />
              </div>
              <div className="faint" style={{ fontSize: 12 }}>MP3, OGG, M4A, WAV or FLAC, up to 30 MB each. For several files, names like "Artist - Title.mp3" fill in automatically.</div>
              <div className="row" style={{ gap: 8 }}><Btn variant="primary" disabled={busy} onClick={() => void upload()}>Upload</Btn>{progress && <span className="faint" style={{ fontSize: 12 }}>{progress}</span>}</div>
            </div>
          </Panel>
          <Panel title="Playlist" right={<span className="chip">{tracks.length} tracks</span>}>
            {tracks.length === 0 && <div className="empty">No tracks yet.</div>}
            <div className="col" style={{ gap: 4 }}>
              {tracks.map((t, i) => (
                <div key={t.id} className="list-item" style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 8, alignItems: 'center', padding: '6px 8px' }}>
                  <span className="mono faint">{i + 1}</span>
                  <div className="col" style={{ gap: 0, minWidth: 0 }}>
                    <b className="truncate">{t.title}</b>
                    <span className="faint truncate" style={{ fontSize: 11 }}>{t.artist} · added by {t.addedBy}</span>
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn small ghost" onClick={() => useMusic.getState().play(t.id)}>▶</button>
                    <button className="btn small ghost" disabled={i === 0} onClick={() => void NetworkManager.call('music:move', { id: t.id, delta: -1 })}>↑</button>
                    <button className="btn small ghost" disabled={i === tracks.length - 1} onClick={() => void NetworkManager.call('music:move', { id: t.id, delta: 1 })}>↓</button>
                    <button className="btn small ghost" onClick={() => { if (confirm(`Remove "${t.title}" from the playlist?`)) void NetworkManager.call('music:remove', { id: t.id }); }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <Panel title="Server">
          <div className="col" style={{ gap: 6, fontSize: 13 }}>
            <div>Online: <b>{lobby?.players.length ?? 0}</b></div>
            <div>Matches in progress: <b>{lobby?.matches.length ?? 0}</b></div>
            <div>Derby: <b>{lobby?.derby ? `race ${lobby.derby.number} (${lobby.derby.phase}), ${lobby.derby.watchers} track-side` : 'off'}</b></div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
