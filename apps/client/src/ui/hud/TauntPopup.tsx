// Taunt cam: when a player emotes, a framed broadcast-style cut-in pops up
// showing that player's own commander performing the gesture, with their name
// and a big caption. Rendered in its own small canvas so the board is untouched.

import type React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Color, FactionId } from '@ashen/shared';
import { AudioManager } from '../../core/AudioManager';
import { FactionManager } from '../../game/FactionManager';
import { useGame } from '../../game/GameController';
import type { PieceVisual } from '../../game/pieces/PieceVisual';
import { EMOTES } from './GameHud';

/** Emote -> animation clip from the shared humanoid library (first one found plays). */
const CLIP: Record<string, string[]> = {
  gg: ['Salute', 'CrossArms'],
  wow: ['Standing_Jump', 'Salute'],
  taunt: ['Melee_TwoHanded', 'Melee_OneHanded', 'CrossArms'],
  salute: ['Salute'],
  oops: ['Falling', 'Idle_CheckWatch'],
  thinking: ['Idle_CheckWatch', 'CrossArms'],
};
const CAPTION: Record<string, string> = { gg: 'Good game', wow: 'Wow!', taunt: 'Come on then!', salute: 'Respect.', oops: 'Oops…', thinking: 'Hmm…' };
const SHOW_MS = 3200;

interface Shot { key: number; color: Color; emote: string; name: string; faction: FactionId }

export function TauntPopup() {
  const emote = useGame((s) => s.emote);
  const players = useGame((s) => s.players);
  const me = useGame((s) => s.me);
  const [shot, setShot] = useState<Shot | null>(null);

  useEffect(() => {
    if (!emote || emote.color === 'spectator' || Date.now() - emote.at > 1500) return;
    const p = players[emote.color];
    if (!p) return;
    setShot({ key: emote.at, color: emote.color, emote: emote.emote, name: p.name, faction: p.faction });
    AudioManager.play(emote.emote === 'taunt' ? 'swing_heavy' : 'ui_select');
    const t = window.setTimeout(() => setShot((s) => (s && s.key === emote.at ? null : s)), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [emote, players]);

  if (!shot) return null;
  const mine = me === shot.color;
  const side: React.CSSProperties = mine ? { right: 24 } : { left: 24 };
  return (
    <div key={shot.key} className="pe-none" style={{ position: 'absolute', top: '50%', width: 300, ...side, animation: `${mine ? 'taunt-in-r' : 'taunt-in-l'} 0.35s cubic-bezier(.2,1.4,.4,1) both` }}>
      <section className="panel" style={{ overflow: 'hidden', borderColor: 'var(--amber)', boxShadow: '0 18px 50px rgba(0,0,0,0.6)' }}>
        <div className="hazard" />
        <div style={{ height: 300, background: 'radial-gradient(ellipse at 50% 40%, #3a2a1c 0%, #120d09 75%)' }}>
          <Canvas dpr={[1, 2]} camera={{ fov: 30, position: [0, 0.8, 2.7] }} gl={{ antialias: true, alpha: true }}>
            <TauntModel faction={shot.faction} side={shot.color} emote={shot.emote} />
          </Canvas>
        </div>
        <div style={{ padding: '10px 14px' }}>
          <div className="eyebrow">{shot.name}</div>
          <div style={{ fontFamily: 'var(--font-head)', fontSize: 30, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--amber)', lineHeight: 1.1 }}>
            {CAPTION[shot.emote] ?? EMOTES[shot.emote] ?? shot.emote}
          </div>
        </div>
      </section>
      <style>{`
        @keyframes taunt-in-l { from { opacity: 0; transform: translate(-60px, -50%) scale(0.9); } to { opacity: 1; transform: translate(0, -50%); } }
        @keyframes taunt-in-r { from { opacity: 0; transform: translate(60px, -50%) scale(0.9); } to { opacity: 1; transform: translate(0, -50%); } }
      `}</style>
    </div>
  );
}

function TauntModel({ faction, side, emote }: { faction: FactionId; side: Color; emote: string }) {
  const visual = useMemo<PieceVisual>(() => FactionManager.createVisual(faction, 'king', side), [faction, side]);
  const group = useRef<THREE.Group>(null!);
  useEffect(() => {
    if (visual.base) visual.base.visible = false;
    const sv = visual as PieceVisual & { playClip?: (n: string, loop?: boolean) => boolean };
    const ok = (CLIP[emote] ?? []).some((c) => sv.playClip?.(c));
    if (!ok) visual.play(emote === 'taunt' ? 'TAUNT' : 'VICTORY');
    return () => visual.dispose();
  }, [visual, emote]);
  const camera = useThree((st) => st.camera);
  useEffect(() => { camera.lookAt(0, 0.68, 0); }, [camera]);
  useFrame((_, dt) => {
    visual.update(dt);
    // Frame the model at ~1.3 units tall with a slow sway toward camera.
    group.current.scale.setScalar(1.3 / Math.max(0.3, visual.height));
    group.current.rotation.y = Math.sin(performance.now() / 1400) * 0.25;
  });
  return (
    <>
      <hemisphereLight args={['#ffe0c0', '#2a1a10', 1.2]} />
      <spotLight position={[1.5, 3, 2.5]} angle={0.5} penumbra={0.6} intensity={30} color="#ffd8a8" />
      <directionalLight position={[-2, 1.5, -1]} intensity={1.2} color="#7fa8ff" />
      <group ref={group}><primitive object={visual.object} /></group>
    </>
  );
}
