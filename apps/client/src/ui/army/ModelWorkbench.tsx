// ModelWorkbench — fit an uploaded model to the board: shows the square
// footprint, the pedestal, min/max height guides, the bounding box, and plays
// mapped clips. Optional neighbouring pieces preview board placement/scale.

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CLASS_TO_TYPE, PERFORMANCE_BUDGET, type PieceClass } from '@ashen/shared';
import { applyTransform, boundsOf, type ImportedModel, type PieceTransform } from '../../game/ModelImportManager';
import { buildPedestal, buildProceduralPiece } from '../../game/pieces/ProceduralPieceFactory';
import { concreteTexture, steelPlateTexture } from '../../game/textures';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

interface Props {
  model: ImportedModel | null;
  transform: PieceTransform;
  pieceClass: PieceClass;
  playClip: string | null;
  showNeighbours: boolean;
  height?: number;
}

function Workbench({ model, transform, pieceClass, playClip, showNeighbours }: Props) {
  const group = useRef<THREE.Group>(null!);
  const mixer = useRef<THREE.AnimationMixer | null>(null);

  const board = useMemo(() => {
    const g = new THREE.Group();
    const light = new THREE.MeshStandardMaterial({ map: concreteTexture(256, 1, '#b0a594'), roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ map: steelPlateTexture(256, 5, '#3a3530'), roughness: 0.55, metalness: 0.7 });
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.06, 0.98), (x + z) % 2 === 0 ? dark : light);
      m.position.set(x, -0.03, z);
      m.receiveShadow = true;
      g.add(m);
    }
    // Footprint square + height guides.
    const sq = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.001, 1)), new THREE.LineBasicMaterial({ color: '#ffc861' }));
    sq.position.y = 0.06;
    g.add(sq);
    for (const [h, c] of [[PERFORMANCE_BUDGET.minHeight, '#7fc06a'], [PERFORMANCE_BUDGET.maxHeight, '#ff4a2a']] as const) {
      const ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.001, 1)), new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.5 }));
      ring.position.y = h;
      g.add(ring);
    }
    return g;
  }, []);

  const pedestal = useMemo(() => buildPedestal(pieceClass, 'w', '#2a2620').group, [pieceClass]);
  const neighbours = useMemo(() => {
    const g = new THREE.Group();
    for (const [x, pc] of [[-1, 'pawn'], [1, pieceClass === 'pawn' ? 'knight' : 'pawn']] as const) {
      const rig = buildProceduralPiece('remnants', pc as PieceClass, 'w');
      rig.root.position.x = x;
      rig.root.rotation.y = 0;
      g.add(rig.root);
    }
    return g;
  }, [pieceClass]);

  const display = useMemo(() => {
    if (!model) return null;
    const clone = SkeletonUtils.clone(model.scene);
    const holder = applyTransform(clone, transform);
    holder.position.y = 0.05;
    return holder;
  }, [model, transform]);

  const box = useMemo(() => {
    if (!display) return null;
    return new THREE.Box3Helper(boundsOf(display), new THREE.Color('#39d0ff'));
  }, [display]);

  useEffect(() => {
    mixer.current?.stopAllAction();
    mixer.current = null;
    if (!display || !model || !playClip) return;
    const clip = model.animations.find((a) => a.name === playClip);
    if (!clip) return;
    const m = new THREE.AnimationMixer(display.children[0]);
    m.clipAction(clip).play();
    mixer.current = m;
  }, [display, model, playClip]);

  useFrame((_, dt) => { mixer.current?.update(dt); if (!playClip && group.current) group.current.rotation.y += dt * 0.25; else if (group.current) group.current.rotation.y *= 0.9; });

  return (
    <>
      <hemisphereLight args={['#c8b090', '#20160f', 1.3]} />
      <directionalLight position={[2.5, 5, 3]} intensity={2.6} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-2} shadow-camera-right={2} shadow-camera-top={2} shadow-camera-bottom={-2} />
      <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#88a8d8" />
      <primitive object={board} />
      {showNeighbours && <primitive object={neighbours} />}
      <group ref={group}>
        <primitive object={pedestal} />
        {display && <primitive object={display} />}
      </group>
      {box && <primitive object={box} />}
      <OrbitControls target={[0, 0.5, 0]} minDistance={1.2} maxDistance={7} enablePan={false} />
    </>
  );
}

export function ModelWorkbench(props: Props) {
  return (
    <Canvas shadows dpr={[1, 1.5]} camera={{ position: [1.8, 1.4, 2.4], fov: 38 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      style={{ width: '100%', height: props.height ?? 300, background: 'radial-gradient(ellipse at center, #2a221a 0%, #0d0b09 80%)' }}>
      <Workbench {...props} />
    </Canvas>
  );
}

export { CLASS_TO_TYPE };
