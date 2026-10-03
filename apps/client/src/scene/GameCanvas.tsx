// GameCanvas — the single persistent WebGL view shared by every screen. It
// mounts the imperative BoardStage + ArenaEnvironment, lighting, fog,
// shadows and post-processing according to the graphics preset, and routes
// pointer input to the GameController.

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Noise, Vignette, SMAA } from '@react-three/postprocessing';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ARENAS, type ArenaDef } from '@ashen/shared';
import { useSettings } from '../core/settings';
import { ArenaEnvironment } from '../game/ArenaEnvironment';
import { BoardStage } from '../game/BoardStage';
import { FactionManager } from '../game/FactionManager';
import { AssetManager } from '../game/AssetManager';
import { GameController, useGame } from '../game/GameController';
import { DerbyStage } from '../game/derby/DerbyStage';
import { PokerStage } from '../game/poker/PokerStage';
import { usePoker } from '../ui/screens/PokerScreen';
import { useApp } from '../core/store';
import { useDerby } from '../core/derbyStore';

/** Shared handle so tools (Combat Lab, dev panel, army preview) can reach the live stage. */
export const StageHandle: { current: BoardStage | null; env: ArenaEnvironment | null; fps: number; gl: THREE.WebGLRenderer | null; derby: DerbyStage | null } = { current: null, env: null, fps: 0, gl: null, derby: null };

export function arenaFor(arenaId: string | null | undefined): ArenaDef {
  if (!arenaId) return ARENAS[0];
  const kotb = /^kotb-(\d+)$/.exec(arenaId);
  if (kotb) return ARENAS[(Number(kotb[1]) - 1) % ARENAS.length];
  return ARENAS.find((a) => a.id === arenaId) ?? ARENAS[0];
}

function StageMount({ arenaId }: { arenaId: string | null }) {
  const { camera, scene, gl, size } = useThree();
  const graphics = useSettings((s) => s.graphics);
  const showCoords = useSettings((s) => s.showCoordinates);
  const sensitivity = useSettings((s) => s.cameraSensitivity);
  const stage = useMemo(() => new BoardStage(camera as THREE.PerspectiveCamera, { textureSize: graphics.textureSize, detail: graphics.environmentDetail }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const sun = useRef<THREE.DirectionalLight>(null!);
  const hemi = useRef<THREE.HemisphereLight>(null!);
  const fpsAcc = useRef({ t: 0, n: 0 });
  const derby = useMemo(() => new DerbyStage(), []);
  const derbyOn = useApp((s) => s.screen === 'derby');
  const derbyRef = useRef(false);
  const poker = useMemo(() => new PokerStage(), []);
  const pokerOn = useApp((s) => s.screen === 'poker');
  const pokerRef = useRef(false);

  useEffect(() => {
    StageHandle.current = stage;
    StageHandle.gl = gl;
    scene.add(stage.root);
    GameController.attach(stage);
    if (import.meta.env.DEV) {
      // Visual QA hook: render a full-size frame and save it to /.qa/<name>.png via the dev server.
      (window as unknown as Record<string, unknown>).__ashen = {
        stage, gl, scene, camera, GameController, useApp, useGame, AssetManager, FactionManager, StageHandle, useDerby,
        async shot(name: string, w = 1600, h = 900) {
          const cam = camera as THREE.PerspectiveCamera;
          const prev = new THREE.Vector2();
          gl.getSize(prev);
          const prevAspect = cam.aspect;
          gl.setSize(w, h, false);
          cam.aspect = w / h; cam.updateProjectionMatrix();
          gl.render(scene, cam);
          const data = gl.domElement.toDataURL('image/png');
          gl.setSize(prev.x, prev.y, false);
          cam.aspect = prevAspect; cam.updateProjectionMatrix();
          return fetch('/__dev/screenshot', { method: 'POST', body: JSON.stringify({ name, data }) }).then((r) => r.text());
        },
      };
      // Bridge for automation tools that run in an isolated JS world: put code in
      // <html data-qa>, dispatch a 'qa' event, read <html data-qa-result>.
      const onQa = async () => {
        const root = document.documentElement;
        try {
          const fn = new Function('A', `return (async () => { ${root.dataset.qa ?? ''} })()`);
          const out = await fn((window as unknown as Record<string, unknown>).__ashen);
          root.dataset.qaResult = JSON.stringify(out ?? null);
        } catch (e) { root.dataset.qaResult = `ERROR: ${(e as Error).stack ?? e}`; }
      };
      window.addEventListener('qa', onQa);
      window.addEventListener('qa-detach', () => window.removeEventListener('qa', onQa), { once: true });
    }
    const detach = stage.camera.attach(gl.domElement);
    return () => { detach(); scene.remove(stage.root); StageHandle.current = null; window.dispatchEvent(new Event('qa-detach')); };
  }, [stage, scene, gl]);

  useEffect(() => { stage.camera.sensitivity = sensitivity; }, [stage, sensitivity]);
  useEffect(() => { stage.showLabels(showCoords); }, [stage, showCoords]);
  useEffect(() => { stage.fx.density = graphics.particles; FactionManager.quality = graphics.animationQuality === 'high' ? 1 : 0.4; }, [stage, graphics.particles, graphics.animationQuality]);
  useEffect(() => { stage.fx.setViewportHeight(size.height); derby.setViewportHeight(size.height); }, [stage, derby, size.height]);

  // Wasteland Derby takes over the view: hide the board, its arena and lights.
  useEffect(() => {
    scene.add(derby.root, poker.root);
    StageHandle.derby = derby;
    const unsub = usePoker.subscribe((s) => poker.sync(s.view));
    return () => { scene.remove(derby.root, poker.root); StageHandle.derby = null; unsub(); };
  }, [derby, poker, scene]);
  useEffect(() => {
    // Derby and poker each take over the view; the board, arena and its lights hide.
    const takeover = derbyOn || pokerOn;
    derbyRef.current = takeover;
    pokerRef.current = pokerOn;
    derby.setActive(derbyOn, scene);
    poker.setActive(pokerOn, scene);
    stage.root.visible = !takeover;
    if (StageHandle.env) StageHandle.env.group.visible = !takeover;
    if (sun.current) sun.current.visible = !takeover;
    if (hemi.current) hemi.current.visible = !takeover;
  }, [derbyOn, pokerOn, derby, poker, scene, stage]);

  // Environment follows the arena of the current match.
  useEffect(() => {
    const def = arenaFor(arenaId);
    StageHandle.env?.dispose();
    if (StageHandle.env) scene.remove(StageHandle.env.group);
    const env = new ArenaEnvironment(def, graphics.environmentDetail, stage.fx);
    StageHandle.env = env;
    scene.add(env.group);
    env.group.visible = !derbyRef.current;
    if (!derbyRef.current) scene.fog = new THREE.FogExp2(def.fogColor, 0.011);
    hemi.current?.color.set(def.ambient);
    sun.current?.color.set(def.sunColor);
    return () => { env.dispose(); scene.remove(env.group); if (StageHandle.env === env) StageHandle.env = null; };
  }, [arenaId, graphics.environmentDetail, scene, stage]);

  // Shadows.
  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    l.castShadow = graphics.shadows > 0;
    if (graphics.shadows > 0) {
      l.shadow.mapSize.set(graphics.shadows, graphics.shadows);
      l.shadow.map?.dispose();
      l.shadow.map = null as never;
    }
    gl.shadowMap.enabled = graphics.shadows > 0;
    gl.shadowMap.type = graphics.shadows >= 2048 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  }, [graphics.shadows, gl]);

  useFrame((_, dt) => {
    if (pokerRef.current) poker.update(dt, camera as THREE.PerspectiveCamera, size);
    else if (derbyRef.current) derby.update(dt, camera as THREE.PerspectiveCamera);
    else { stage.update(dt); StageHandle.env?.update(dt); }
    const a = fpsAcc.current;
    a.t += dt; a.n++;
    if (a.t > 0.5) { StageHandle.fps = Math.round(a.n / a.t); a.t = 0; a.n = 0; }
  });

  // Pointer → board squares.
  useEffect(() => {
    const el = gl.domElement;
    const ndc = new THREE.Vector2();
    let down = { x: 0, y: 0, b: 0 };
    const toNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, b: e.button }; };
    const onUp = (e: PointerEvent) => {
      if (down.b !== 0 || e.altKey || e.shiftKey || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      toNdc(e);
      const hit = stage.pick(ndc, camera);
      GameController.onSquareClick(hit.square);
    };
    let last = 0;
    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - last < 50) return;
      last = now;
      toNdc(e);
      const hit = stage.pick(ndc, camera);
      el.style.cursor = hit.actor && useGame.getState().status === 'playing' ? 'pointer' : 'default';
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointermove', onMove); };
  }, [gl, stage, camera]);

  const def = arenaFor(arenaId);
  return (
    <>
      <hemisphereLight ref={hemi} args={[def.ambient, '#1a1410', 1.1]} />
      <ambientLight intensity={0.18} />
      <directionalLight
        ref={sun}
        position={[9, 14, -6]}
        intensity={2.6}
        color={def.sunColor}
        castShadow={graphics.shadows > 0}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-near={1}
        shadow-camera-far={40}
      />
      <directionalLight position={[-8, 6, 10]} intensity={0.55} color="#8fa4c0" />
    </>
  );
}

function Effects() {
  const pp = useSettings((s) => s.graphics.postprocessing);
  if (pp === 0) return null;
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={pp === 2 ? 0.9 : 0.6} luminanceThreshold={0.82} luminanceSmoothing={0.2} mipmapBlur />
      <Vignette offset={0.28} darkness={0.62} />
      {pp === 2 ? <Noise opacity={0.028} premultiply /> : <></>}
      {pp === 2 ? <SMAA /> : <></>}
    </EffectComposer>
  );
}

export function GameCanvas() {
  const dpr = useSettings((s) => s.graphics.dpr);
  const arenaId = useGame((s) => s.arenaId);
  return (
    <Canvas
      className="game-canvas"
      dpr={[1, dpr]}
      shadows
      camera={{ fov: 40, near: 0.1, far: 600, position: [0, 12, 14] }}
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onCreated={({ gl }) => { gl.setClearColor('#0d0b09'); }}
    >
      <StageMount arenaId={arenaId} />
      <Effects />
    </Canvas>
  );
}
