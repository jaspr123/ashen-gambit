import { lazy, Suspense, useEffect } from 'react';
import { NetworkManager } from './core/NetworkManager';
import { useApp } from './core/store';
import { GameController } from './game/GameController';
import { GameCanvas } from './scene/GameCanvas';
import { BootScreen } from './ui/screens/BootScreen';
import { LobbyScreen } from './ui/screens/LobbyScreen';
import { LoadoutScreen } from './ui/screens/LoadoutScreen';
import { GameHud } from './ui/hud/GameHud';
import { ProfileScreen } from './ui/screens/ProfileScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { DerbyScreen } from './ui/screens/DerbyScreen';
import { AdminScreen } from './ui/screens/AdminScreen';
import { PokerScreen } from './ui/screens/PokerScreen';
import { Toasts, ChallengePrompts } from './ui/Overlays';
import { DevPanel } from './ui/dev/DevPanel';

const ArmyCreator = lazy(() => import('./ui/army/ArmyCreator'));
const CombatLab = lazy(() => import('./ui/dev/CombatLab'));

export function App() {
  const screen = useApp((s) => s.screen);
  const onlineMatch = useApp((s) => s.onlineMatch);
  const devPanel = useApp((s) => s.devPanel);

  // Server pushes a match (queue pop, challenge accepted, reconnect) -> go to the board.
  useEffect(() => NetworkManager.onMatchState((m) => {
    void GameController.loadOnline(m);
    if (useApp.getState().screen !== 'game') useApp.getState().go('game');
  }), []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === '`' || e.key === 'F9') useApp.setState({ devPanel: !useApp.getState().devPanel });
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  void onlineMatch;

  return (
    <>
      <GameCanvas />
      <div className="ui-root">
        {screen === 'boot' && <BootScreen />}
        {screen === 'lobby' && <LobbyScreen />}
        {screen === 'loadout' && <LoadoutScreen />}
        {(screen === 'game' || screen === 'replay') && <GameHud />}
        {screen === 'profile' && <ProfileScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'derby' && <DerbyScreen />}
        {screen === 'admin' && <AdminScreen />}
        {screen === 'poker' && <PokerScreen />}
        <Suspense fallback={<div className="screen" style={{ display: 'grid', placeItems: 'center' }}><div className="eyebrow pulse">Loading module…</div></div>}>
          {screen === 'army' && <ArmyCreator />}
          {screen === 'lab' && <CombatLab />}
        </Suspense>
        <ChallengePrompts />
        <Toasts />
        {devPanel && <DevPanel />}
      </div>
    </>
  );
}
