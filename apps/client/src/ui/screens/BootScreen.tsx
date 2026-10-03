import { useState } from 'react';
import { AudioManager } from '../../core/AudioManager';
import { NetworkManager } from '../../core/NetworkManager';
import { describeError, useApp } from '../../core/store';
import { Btn, Seg } from '../common';

type Tab = 'guest' | 'login' | 'register';

export function BootScreen() {
  const saved = NetworkManager.savedName;
  const hasToken = !!NetworkManager.token;
  const [tab, setTab] = useState<Tab>('guest');
  const [name, setName] = useState(saved);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validName = /^[\w\- .]{2,20}$/.test(name.trim());

  const enter = (asGuest = true) => {
    AudioManager.unlock();
    AudioManager.startAmbience();
    AudioManager.startMusic();
    NetworkManager.connect(asGuest && !NetworkManager.token ? name.trim() : undefined);
    useApp.getState().go('lobby');
  };

  const account = async () => {
    setBusy(true); setError('');
    try {
      NetworkManager.forgetIdentity();
      await NetworkManager.account(tab === 'login' ? 'login' : 'register', name.trim(), password);
      enter(false);
    } catch (e) {
      setError(describeError((e as Error).message));
    } finally { setBusy(false); }
  };

  return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', background: 'radial-gradient(ellipse at center, transparent 30%, rgba(8,6,4,0.75) 100%)' }}>
      <div className="col" style={{ alignItems: 'center', gap: 6, marginBottom: 34, textAlign: 'center' }}>
        <div className="eyebrow">Sector 7 · Signal acquired</div>
        <h1 style={{ fontSize: 'clamp(46px, 8vw, 96px)', letterSpacing: '0.18em', lineHeight: 1, textShadow: '0 0 40px rgba(232,162,58,0.35), 0 4px 0 #000' }}>
          ASHEN <span style={{ color: 'var(--amber)' }}>GAMBIT</span>
        </h1>
        <div className="dim" style={{ letterSpacing: '0.3em', fontFamily: 'var(--font-head)', textTransform: 'uppercase', fontSize: 14 }}>Every capture is a fight</div>
      </div>
      <section className="panel" style={{ width: 'min(420px, calc(100vw - 32px))' }}>
        <div className="hazard" />
        <div className="panel-body col" style={{ gap: 14, padding: 22 }}>
          {hasToken ? (
            <>
              <div className="eyebrow">Identity on file</div>
              <h2 style={{ fontSize: 26 }}>{saved || 'Survivor'}</h2>
              <Btn variant="primary" size="big" block onClick={() => enter()}>Enter the wasteland</Btn>
              <button className="btn ghost small" onClick={() => { void NetworkManager.logout().then(() => location.reload()); }}>Log out / switch account</button>
            </>
          ) : (
            <>
              <Seg<Tab> value={tab} onChange={(t) => { setTab(t); setError(''); }} options={[{ value: 'guest', label: 'Guest' }, { value: 'login', label: 'Log in' }, { value: 'register', label: 'Create account' }]} />
              <div className="field">
                <label>Callsign</label>
                <input className="input" autoFocus maxLength={20} value={name} placeholder="e.g. KnightHunter" autoComplete="username"
                  onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && validName && tab === 'guest') enter(); }} />
              </div>
              {tab !== 'guest' && (
                <div className="field">
                  <label>Password</label>
                  <input className="input" type="password" maxLength={128} value={password} autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                    onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && validName && password.length >= 8) void account(); }} />
                </div>
              )}
              {error && <div className="red" style={{ fontSize: 13 }}>{error}</div>}
              {tab === 'guest'
                ? <Btn variant="primary" size="big" block disabled={!validName} onClick={() => enter()}>Enter the wasteland</Btn>
                : <Btn variant="primary" size="big" block disabled={!validName || password.length < 8 || busy} onClick={() => void account()}>{tab === 'login' ? 'Log in' : 'Create account'}</Btn>}
              <div className="faint" style={{ fontSize: 12 }}>
                {tab === 'guest' ? 'A guest identity is remembered on this device. You can add a password later from your profile.'
                  : tab === 'login' ? 'Use the callsign and password of an existing account.' : 'Accounts keep your rating, stats, armies and Derby bank on every device.'}
              </div>
            </>
          )}
        </div>
      </section>
      <div className="faint mono" style={{ position: 'absolute', bottom: 16, fontSize: 11 }}>Right-drag to orbit · wheel to zoom · Q/E rotate · ` dev panel</div>
    </div>
  );
}
