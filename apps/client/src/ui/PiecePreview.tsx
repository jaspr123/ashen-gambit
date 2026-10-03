// PiecePreview — an independent mini-stage (its own canvas) that shows one
// piece on a real board section: turntable/orbit, play any action, any death,
// or a full capture sequence against a dummy defender.

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react';
import * as THREE from 'three';
import { CLASS_TO_TYPE, type DeathTypeId, type FactionId, type GameAction, type PieceClass } from '@ashen/shared';
import { BoardStage } from '../game/BoardStage';
import { squareToWorld } from '../game/coords';
import { FactionManager } from '../game/FactionManager';
import type { PieceActor } from '../game/PieceActor';

export interface PiecePreviewHandle {
  play(action: GameAction): void;
  death(type: DeathTypeId): void;
  capture(finisherId: string, defenderClass?: PieceClass): void;
  reset(): void;
}

interface Props { faction: FactionId; pieceClass: PieceClass; enemyFaction: FactionId; height?: number }

const ATTACKER_SQ = 'd4', DEFENDER_SQ = 'd5';

const Inner = forwardRef<PiecePreviewHandle, Props>(function Inner({ faction, pieceClass, enemyFaction }, ref) {
  const { camera, scene, gl } = useThree();
  const stage = useMemo(() => new BoardStage(camera as THREE.PerspectiveCamera, { textureSize: 512, detail: 0.2 }), [camera]);
  const state = useMemo(() => ({ actor: null as PieceActor | null, defender: null as PieceActor | null, busy: false }), []);

  const spawn = () => {
    stage.clearPieces();
    stage.deaths.finishAll();
    stage.fx.clearTransient();
    stage.factions = { w: faction, b: enemyFaction };
    state.actor = stage.createActor(CLASS_TO_TYPE[pieceClass], 'w', ATTACKER_SQ, faction);
    state.defender = null;
    state.busy = false;
  };

  useEffect(() => {
    scene.add(stage.root);
    stage.camera.setMode('lab');
    stage.camera.setTarget(squareToWorld(ATTACKER_SQ).add(new THREE.Vector3(0, 0.35, -0.4)));
    const detach = stage.camera.attach(gl.domElement);
    return () => { detach(); scene.remove(stage.root); stage.dispose(); };
  }, [stage, scene, gl]);

  useEffect(() => { void FactionManager.preload([faction, enemyFaction]).then(spawn); }, [faction, pieceClass, enemyFaction]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    play(action) { if (!state.actor || !state.actor.alive) spawn(); state.actor!.visual.play(action); },
    death(type) {
      if (state.busy) return;
      if (!state.actor?.alive) spawn();
      state.busy = true;
      const a = state.actor!;
      void stage.deaths.kill(a, type, new THREE.Vector3(0, 0, 1), Math.floor(Math.random() * 1000)).then(() => { stage.removeActor(a); spawn(); });
    },
    capture(finisherId, defenderClass = 'pawn') {
      if (state.busy) return;
      spawn();
      state.busy = true;
      const def = stage.createActor(CLASS_TO_TYPE[defenderClass], 'b', DEFENDER_SQ, enemyFaction);
      state.defender = def;
      const target = squareToWorld(DEFENDER_SQ);
      void stage.combat.capture(state.actor!, def, target, { finisherId, seed: Math.floor(Math.random() * 1000), speed: 1 }).then(async () => {
        await stage.wait(1.6);
        stage.removeActor(def);
        spawn();
      });
    },
    reset: spawn,
  }), [stage, state, faction, pieceClass, enemyFaction]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => stage.update(dt));
  return (
    <>
      <hemisphereLight args={['#a89070', '#1a1410', 1.2]} />
      <directionalLight position={[4, 8, 5]} intensity={2.4} color="#ffd2a0" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <directionalLight position={[-5, 3, -4]} intensity={0.8} color="#7aa0d0" />
      <fog attach="fog" args={['#120e0b', 8, 18]} />
    </>
  );
});

export const PiecePreview = forwardRef<PiecePreviewHandle, Props>(function PiecePreview(props, ref) {
  return (
    <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 35, position: [3, 3, 5] }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }} style={{ width: '100%', height: props.height ?? 360, background: 'radial-gradient(ellipse at center, #2a221a 0%, #0d0b09 75%)' }}>
      <Inner ref={ref} {...props} />
    </Canvas>
  );
});
