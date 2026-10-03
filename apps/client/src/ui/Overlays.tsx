import { GAME_MODES, timeControlLabel } from '@ashen/shared';
import { NetworkManager } from '../core/NetworkManager';
import { useApp } from '../core/store';
import { Btn } from './common';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>{t.text}</div>)}
    </div>
  );
}

export function ChallengePrompts() {
  const challenges = useApp((s) => s.challenges);
  if (!challenges.length) return null;
  const c = challenges[0];
  const respond = (accept: boolean) => {
    void NetworkManager.call('challenge:respond', { challengeId: c.challengeId, accept }).catch(() => {});
    useApp.setState({ challenges: challenges.slice(1) });
  };
  return (
    <div style={{ position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 45 }}>
      <section className="panel" style={{ width: 380 }}>
        <div className="hazard" />
        <div className="panel-body col">
          <div className="eyebrow pulse">Incoming challenge</div>
          <h2 style={{ fontSize: 22 }}>{c.from.name} <span className="dim mono" style={{ fontSize: 13 }}>{c.from.rating}</span></h2>
          <div className="dim">{GAME_MODES[c.mode].name} · {timeControlLabel(c.timeControl)}</div>
          <div className="row" style={{ marginTop: 6 }}>
            <Btn variant="primary" className="grow" onClick={() => respond(true)}>Accept</Btn>
            <Btn variant="ghost" onClick={() => respond(false)}>Decline</Btn>
          </div>
        </div>
      </section>
    </div>
  );
}
