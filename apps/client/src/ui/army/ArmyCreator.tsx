// Custom Army Creator — upload models, assign them to the six chess classes,
// fit them to the board, map animations (or accept procedural fallbacks),
// choose deaths, author kill sequences, validate, and save. A model alone is
// never enough: every piece must be configured for combat before going online.

import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  ANIMATION_LIMITS, DEATH_TYPES, DEATH_TYPE_IDS, FACTIONS, FACTION_IDS, GAME_ACTIONS, PIECE_CLASSES, REQUIRED_ACTIONS, START_FEN,
  finishersFor, validateCustomArmy, type BuiltinFactionId, type CombatSequence, type CustomArmy, type CustomPiece, type DeathTypeId, type GameAction,
  type PieceClass, type ValidationIssue,
} from '@ashen/shared';
import { NetworkManager } from '../../core/NetworkManager';
import { useApp } from '../../core/store';
import { AssetManager } from '../../game/AssetManager';
import { detectSkeleton, retargetClips, suggestClipMap } from '../../game/AnimationMappingManager';
import { FactionManager } from '../../game/FactionManager';
import { GameController } from '../../game/GameController';
import { applyTransform, autoFit, exportGlb, importModelFiles, measure, renderThumbnail, type ImportedModel, type PieceTransform } from '../../game/ModelImportManager';
import { GLYPHS } from '../../game/pieces/ProceduralPieceFactory';
import { StageHandle } from '../../scene/GameCanvas';
import { Btn, Panel, Seg } from '../common';
import CombatLab from '../dev/CombatLab';
import { TopBar } from '../TopBar';
import { KillSequenceEditor } from './KillSequenceEditor';
import { ModelWorkbench } from './ModelWorkbench';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

type StoredArmy = CustomArmy & { valid?: boolean };
type Tab = 'model' | 'anims' | 'deaths' | 'sequences' | 'validate';
const DRAFT_ID = 'draft';

function newArmy(): CustomArmy {
  return { id: '', name: 'New Army', doctrine: 'remnants', palette: { primary: '#8a7a5a', accent: '#e8a23a', base: '#2a2620' }, pieces: { pawn: null, knight: null, bishop: null, rook: null, queen: null, king: null }, sequences: [], bindings: {}, createdAt: Date.now(), updatedAt: Date.now() };
}

function defaultDeaths(rig: CustomPiece['rig']): DeathTypeId[] {
  return rig === 'mechanical' || rig === 'vehicle' ? ['mechanical_collapse', 'disassembly'] : rig === 'static' ? ['knockback_death', 'side_collapse'] : ['backward_collapse', 'kneel_and_fall'];
}

export default function ArmyCreator() {
  const go = useApp((s) => s.go);
  const connection = useApp((s) => s.connection);
  const [armies, setArmies] = useState<StoredArmy[]>([]);
  const [army, setArmy] = useState<CustomArmy>(newArmy);
  const [imports, setImports] = useState<Partial<Record<PieceClass, ImportedModel>>>({});
  const [sel, setSel] = useState<PieceClass>('pawn');
  const [tab, setTab] = useState<Tab>('model');
  const [playClip, setPlayClip] = useState<string | null>(null);
  const [neighbours, setNeighbours] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [seqId, setSeqId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [perf, setPerf] = useState<{ fps: number; tris: number; calls: number } | null>(null);
  const [serverIssues, setServerIssues] = useState<ValidationIssue[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingClass = useRef<PieceClass>('pawn');
  const piece = army.pieces[sel];
  const imp = imports[sel] ?? null;
  const armyId = army.id || DRAFT_ID;
  const factionId = `custom:${armyId}` as const;

  const refreshList = () => NetworkManager.call('army:list', {}, { quiet: true }).then((r) => setArmies(r as StoredArmy[])).catch(() => {});
  useEffect(() => { void refreshList(); GameController.enterLab(); StageHandle.current?.camera.setMode('tactical'); }, []);

  // Keep the live registry in sync so board previews use the current draft.
  useEffect(() => { FactionManager.registerArmy({ ...army, id: armyId }); }, [army, armyId]);

  const setPiece = (pc: PieceClass, patch: Partial<CustomPiece>) => setArmy((a) => ({ ...a, pieces: { ...a.pieces, [pc]: { ...a.pieces[pc]!, ...patch } }, updatedAt: Date.now() }));

  // ------------------------------------------------------------------ import
  const onFiles = async (pc: PieceClass, files: File[]) => {
    if (!files.length) return;
    setBusy(`Importing ${files[0].name}…`);
    try {
      const im = await importModelFiles(files);
      const skel = detectSkeleton(im.scene);
      const skinned = skel.kind !== 'none';
      // Offer the shared humanoid library when a compatible rig arrives without enough clips.
      if (skinned && im.animations.length < 3) {
        const lib = await AssetManager.loadManifest().then((m) => m?.animations?.humanoid).catch(() => undefined);
        if (lib) {
          const g = await AssetManager.load(`/assets/${lib}`).catch(() => null);
          if (g) {
            const r = retargetClips(im.scene, g.scene, g.animations);
            if (r.clips.length) { im.animations.push(...r.clips); im.warnings.push(`Retargeted ${r.clips.length} library clips (${r.matched} bones matched).`); }
          }
        }
      }
      const t = autoFit(im.scene, pc);
      const clipMap = suggestClipMap(im.animations.map((a) => a.name));
      const rig: CustomPiece['rig'] = skinned ? 'humanoid' : 'static';
      const stats = measure(im, t);
      const thumb = renderThumbnail(applyTransform(SkeletonUtils.clone(im.scene), t));
      let modelUrl: string;
      const glb = await exportGlb(im);
      if (connection === 'online') {
        setBusy('Uploading…');
        modelUrl = (await NetworkManager.uploadModel(glb)).url;
      } else modelUrl = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
      await AssetManager.load(modelUrl);
      const p: CustomPiece = {
        pieceClass: pc, modelUrl, fileName: im.fileName, format: im.format, transform: t, rig, fallback: skinned ? 'humanoid' : 'transform',
        clipMap, acceptedFallbacks: [], deaths: defaultDeaths(rig), thumbnail: thumb, stats,
      };
      setImports((x) => ({ ...x, [pc]: im }));
      setArmy((a) => ({ ...a, pieces: { ...a.pieces, [pc]: p }, updatedAt: Date.now() }));
      setSel(pc);
      setTab('model');
      im.warnings.forEach((w) => useApp.getState().toast('warn', w));
      if (im.missingTextures.length) useApp.getState().toast('error', `Missing textures: ${im.missingTextures.join(', ')}`);
    } catch (e) {
      useApp.getState().toast('error', `Import failed: ${(e as Error).message}`);
    } finally { setBusy(null); }
  };

  // Re-measure + thumbnail when the transform changes (debounced).
  const tTimer = useRef<number>(0);
  const setTransform = (t: PieceTransform) => {
    if (!piece) return;
    setPiece(sel, { transform: t });
    clearTimeout(tTimer.current);
    tTimer.current = window.setTimeout(() => {
      if (!imp) return;
      setPiece(sel, { stats: { ...measure(imp, t), clips: piece.stats.clips, fileBytes: piece.stats.fileBytes }, thumbnail: renderThumbnail(applyTransform(SkeletonUtils.clone(imp.scene), t)) });
    }, 250);
  };

  // ------------------------------------------------------------------ load / save
  const loadArmy = async (a: StoredArmy) => {
    setBusy('Loading army…');
    setArmy(a);
    const next: Partial<Record<PieceClass, ImportedModel>> = {};
    for (const pc of PIECE_CLASSES) {
      const p = a.pieces[pc];
      if (!p) continue;
      try {
        const g = await AssetManager.load(p.modelUrl);
        next[pc] = { scene: g.scene, animations: g.animations, format: 'glb', fileName: p.fileName, fileBytes: p.stats.fileBytes, missingTextures: [], warnings: [] };
      } catch { /* shown as load failure in validation */ }
    }
    setImports(next);
    setServerIssues(null);
    setBusy(null);
  };

  const save = async () => {
    if (connection !== 'online') { useApp.getState().toast('warn', 'Saving needs the server; your draft still works for local preview.'); return; }
    setBusy('Saving…');
    try {
      const r = await NetworkManager.call('army:save', { army }) as { army: CustomArmy; valid: boolean; issues: ValidationIssue[] };
      setArmy(r.army);
      setServerIssues(r.issues);
      FactionManager.registerArmy(r.army);
      void refreshList();
      useApp.getState().toast(r.valid ? 'success' : 'warn', r.valid ? 'Army saved and validated for online play' : 'Saved — fix validation errors before public matchmaking');
    } catch { /* toast already shown */ } finally { setBusy(null); }
  };

  // ------------------------------------------------------------------ board preview + perf test
  const previewOnBoard = async () => {
    const st = StageHandle.current;
    if (!st) return;
    GameController.enterLab();
    setBusy('Preparing board…');
    await FactionManager.preload([factionId]);
    st.factions = { w: factionId, b: army.doctrine as BuiltinFactionId };
    st.rebuildActors(START_FEN);
    st.camera.setMode('tactical');
    st.camera.resetView();
    setBusy(null);
  };

  const perfTest = async () => {
    const st = StageHandle.current, gl = StageHandle.gl;
    if (!st || !gl) return;
    setBusy('Measuring performance (3s)…');
    await previewOnBoard();
    st.factions = { w: factionId, b: factionId };
    st.rebuildActors(START_FEN);
    for (const a of st.actors) a.visual.setLocomotion('move');
    const samples: number[] = [];
    await new Promise<void>((resolve) => {
      let last = performance.now(), n = 0;
      const loop = (now: number) => { samples.push(1000 / Math.max(1, now - last)); last = now; if (++n < 180) requestAnimationFrame(loop); else resolve(); };
      requestAnimationFrame(loop);
    });
    for (const a of st.actors) a.visual.setLocomotion('idle');
    samples.sort((a, b) => a - b);
    setPerf({ fps: Math.round(samples[Math.floor(samples.length * 0.1)]), tris: gl.info.render.triangles, calls: gl.info.render.calls });
    setBusy(null);
  };

  // ------------------------------------------------------------------ sequences
  const sequence = army.sequences.find((s) => s.id === seqId) ?? null;
  const addSequence = (fromFinisher: string) => {
    const base = finishersFor(sel).find((f) => f.id === fromFinisher) ?? finishersFor(sel)[0];
    const seq: CombatSequence = { ...structuredClone(base.sequence), id: `seq_${Date.now().toString(36)}`, name: `${army.name} ${sel} strike` };
    setArmy((a) => ({ ...a, sequences: [...a.sequences, seq], bindings: { ...a.bindings, [sel]: seq.id } }));
    setSeqId(seq.id);
  };
  const updateSequence = (s: CombatSequence) => setArmy((a) => ({ ...a, sequences: a.sequences.map((x) => (x.id === s.id ? s : x)) }));
  useEffect(() => { if (tab === 'sequences') setPreviewVersion((v) => v + 1); }, [tab]);

  const localValidation = useMemo(() => ({ pub: validateCustomArmy(army, 'public'), priv: validateCustomArmy(army, 'private') }), [army]);
  const issuesFor = (pc: PieceClass) => localValidation.pub.issues.filter((i) => i.piece === pc && i.severity === 'error').length;

  return (
    <div className="screen pe-none" style={{ animation: 'none' }}>
      <div className="pe-auto"><TopBar back={() => { GameController.startDemo(); go('lobby'); }} title="Custom Army Creator" /></div>
      <input ref={fileInput} type="file" multiple hidden accept=".glb,.gltf,.bin,.fbx,.obj,.mtl,.zip,.png,.jpg,.jpeg,.webp,.tga"
        onChange={(e) => { void onFiles(pendingClass.current, [...(e.target.files ?? [])]); e.target.value = ''; }} />

      {/* ------------------------------------------------ left: army + slots */}
      <div className="pe-auto col" style={{ position: 'absolute', left: 18, top: 76, bottom: 18, width: 310, gap: 10, overflow: 'auto' }}>
        <Panel title="Armies" right={<Btn size="small" variant="ghost" onClick={() => { setArmy(newArmy()); setImports({}); setServerIssues(null); }}>New</Btn>}>
          {armies.length === 0 && <div className="faint" style={{ fontSize: 13 }}>No saved armies yet.</div>}
          {armies.map((a) => (
            <button key={a.id} className="list-item" style={{ width: '100%', background: a.id === army.id ? 'rgba(232,162,58,0.12)' : 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => void loadArmy(a)}>
              <span className="faction-swatch" style={{ background: a.palette.accent }} /><b className="grow truncate">{a.name}</b>
              <span className={`chip ${a.valid ? 'green' : 'red'}`}>{a.valid ? 'valid' : 'draft'}</span>
            </button>
          ))}
        </Panel>
        <Panel title="Identity">
          <div className="col" style={{ gap: 8 }}>
            <input className="input" value={army.name} maxLength={40} onChange={(e) => setArmy({ ...army, name: e.target.value })} />
            <div className="field"><label>War Chess doctrine (abilities)</label>
              <select className="input" value={army.doctrine} onChange={(e) => setArmy({ ...army, doctrine: e.target.value as BuiltinFactionId })}>{FACTION_IDS.map((f) => <option key={f} value={f}>{FACTIONS[f].name} — {FACTIONS[f].identity}</option>)}</select></div>
            <div className="row" style={{ gap: 10 }}>
              {(['primary', 'accent', 'base'] as const).map((k) => (
                <label key={k} className="col" style={{ gap: 2, fontSize: 11 }}><span className="faint mono">{k}</span><input type="color" value={army.palette[k]} onChange={(e) => setArmy({ ...army, palette: { ...army.palette, [k]: e.target.value } })} /></label>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Pieces">
          <div className="col" style={{ gap: 6 }}>
            {PIECE_CLASSES.map((pc) => {
              const p = army.pieces[pc];
              const errs = issuesFor(pc);
              return (
                <div key={pc} className="list-item" style={{ border: `1px solid ${sel === pc ? 'var(--amber)' : 'rgba(232,162,58,0.1)'}`, cursor: 'pointer' }} onClick={() => setSel(pc)}>
                  {p?.thumbnail ? <img src={p.thumbnail} width={44} height={44} style={{ objectFit: 'cover' }} /> : <div className="avatar" style={{ width: 44, height: 44, fontSize: 24 }}>{GLYPHS[pc]}</div>}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b style={{ textTransform: 'capitalize' }}>{pc}</b>
                    <div className="faint truncate" style={{ fontSize: 12 }}>{p ? p.fileName : 'No model assigned'}</div>
                  </div>
                  {p ? <span className={`chip ${errs ? 'red' : 'green'}`}>{errs ? `${errs} err` : 'ok'}</span> : null}
                  <button className="icon-btn" title="Upload model (GLB, GLTF, FBX, OBJ, ZIP)" onClick={(e) => { e.stopPropagation(); pendingClass.current = pc; fileInput.current?.click(); }}>⇪</button>
                </div>
              );
            })}
          </div>
        </Panel>
        <div className="col" style={{ gap: 6 }}>
          <Btn variant="primary" onClick={save} disabled={!!busy}>Save army</Btn>
          <div className="grid2"><Btn size="small" onClick={previewOnBoard}>Preview on board</Btn><Btn size="small" variant="ghost" onClick={perfTest}>Performance test</Btn></div>
        </div>
      </div>

      {/* ------------------------------------------------ right: inspector */}
      <div className="pe-auto col" style={{ position: 'absolute', right: 18, top: 76, bottom: tab === 'sequences' ? 330 : 18, width: 430, gap: 10, overflow: 'auto' }}>
        <div className="seg" style={{ alignSelf: 'stretch', display: 'flex' }}>
          {(['model', 'anims', 'deaths', 'sequences', 'validate'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} style={{ flex: 1 }} onClick={() => setTab(t)}>{{ model: 'Model', anims: 'Animation', deaths: 'Deaths', sequences: 'Kill Seq.', validate: 'Validate' }[t]}</button>
          ))}
        </div>

        {tab === 'model' && (
          <Panel title={`${sel} — model`} right={piece && <span className="chip">{piece.stats.triangles.toLocaleString()} tris</span>}>
            {!piece ? <Empty onUpload={() => { pendingClass.current = sel; fileInput.current?.click(); }} /> : (
              <div className="col" style={{ gap: 10 }}>
                <ModelWorkbench model={imp} transform={piece.transform} pieceClass={sel} playClip={playClip} showNeighbours={neighbours} height={280} />
                <div className="row wrap" style={{ gap: 6 }}>
                  <Btn size="small" onClick={() => imp && setTransform(autoFit(imp.scene, sel, { rotation: piece.transform.rotation }))}>Auto-fit</Btn>
                  <Btn size="small" variant="ghost" onClick={() => setTransform({ ...piece.transform, rotation: [piece.transform.rotation[0], (piece.transform.rotation[1] + 90) % 360, piece.transform.rotation[2]] })}>Turn 90°</Btn>
                  <Btn size="small" variant="ghost" onClick={() => setTransform({ ...piece.transform, rotation: [(piece.transform.rotation[0] + 90) % 360, piece.transform.rotation[1], piece.transform.rotation[2]] })}>Tip X 90°</Btn>
                  <Btn size="small" variant="ghost" onClick={() => imp && setTransform({ ...piece.transform, offset: [piece.transform.offset[0], autoFit(imp.scene, sel, { rotation: piece.transform.rotation }).offset[1] * (piece.transform.scale / Math.max(1e-6, autoFit(imp.scene, sel, { rotation: piece.transform.rotation }).scale)), piece.transform.offset[2]] })}>Ground it</Btn>
                  <label className="row dim" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={neighbours} onChange={(e) => setNeighbours(e.target.checked)} />Neighbours</label>
                </div>
                <Slider label="Scale" value={piece.transform.scale} min={0.0001} max={Math.max(5, piece.transform.scale * 3)} step={piece.transform.scale / 100} onChange={(v) => setTransform({ ...piece.transform, scale: v })} />
                {(['X', 'Y', 'Z'] as const).map((ax, i) => (
                  <Slider key={ax} label={`Rotate ${ax}`} value={piece.transform.rotation[i]} min={-180} max={180} step={1} onChange={(v) => { const r = [...piece.transform.rotation] as [number, number, number]; r[i] = v; setTransform({ ...piece.transform, rotation: r }); }} />
                ))}
                {(['X', 'Y', 'Z'] as const).map((ax, i) => (
                  <Slider key={ax} label={`Origin ${ax}`} value={piece.transform.offset[i]} min={-1} max={1} step={0.005} onChange={(v) => { const o = [...piece.transform.offset] as [number, number, number]; o[i] = v; setTransform({ ...piece.transform, offset: o }); }} />
                ))}
                <div className="mono faint" style={{ fontSize: 11 }}>size {piece.stats.size.map((n) => n.toFixed(2)).join(' × ')} sq · base at y={piece.stats.minY.toFixed(3)} · {piece.stats.materials} mats · {piece.stats.textures} tex · {piece.stats.bones} bones · {(piece.stats.fileBytes / 1024).toFixed(0)} KB</div>
              </div>
            )}
          </Panel>
        )}

        {tab === 'anims' && piece && (
          <Panel title={`${sel} — animation mapping`}>
            <div className="col" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <div className="field grow"><label>Rig type</label>
                  <select className="input" value={piece.rig} onChange={(e) => setPiece(sel, { rig: e.target.value as CustomPiece['rig'] })}>{['humanoid', 'mechanical', 'vehicle', 'creature', 'static'].map((r) => <option key={r}>{r}</option>)}</select></div>
                <div className="field grow"><label>Fallback for unmapped actions</label>
                  <select className="input" value={piece.fallback} onChange={(e) => setPiece(sel, { fallback: e.target.value as CustomPiece['fallback'] })}><option value="humanoid">Humanoid procedural</option><option value="mechanical">Mechanical procedural</option><option value="transform">Whole-object transform</option></select></div>
              </div>
              <div className="faint" style={{ fontSize: 12 }}>{imp ? `${detectSkeleton(imp.scene).kind} skeleton · ${imp.animations.length} clips` : ''}. Required: {REQUIRED_ACTIONS.join(', ')}. Clip limits — attack {ANIMATION_LIMITS.maxClipSeconds.attack}s, hit {ANIMATION_LIMITS.maxClipSeconds.hit}s, death {ANIMATION_LIMITS.maxClipSeconds.death}s.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 26px 26px', gap: 4, alignItems: 'center' }}>
                {GAME_ACTIONS.map((a: GameAction) => {
                  const mapped = piece.clipMap[a];
                  const req = REQUIRED_ACTIONS.includes(a);
                  const accepted = piece.acceptedFallbacks.includes(a);
                  return (
                    <div key={a} style={{ display: 'contents' }}>
                      <span className="mono" style={{ fontSize: 11.5, color: req ? 'var(--amber)' : 'var(--text-dim)' }}>{a}{req ? ' *' : ''}</span>
                      <select className="input" style={{ padding: '3px 6px', fontSize: 12 }} value={mapped ?? ''} onChange={(e) => setPiece(sel, { clipMap: { ...piece.clipMap, [a]: e.target.value || undefined } as CustomPiece['clipMap'] })}>
                        <option value="">{accepted ? '✓ procedural fallback' : '— fallback —'}</option>
                        {piece.stats.clips.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.duration.toFixed(1)}s)</option>)}
                      </select>
                      <button className="icon-btn" style={{ width: 26, height: 26 }} title="Play clip in workbench" disabled={!mapped} onClick={() => { setPlayClip(mapped ?? null); setTab('model'); }}>▶</button>
                      <input type="checkbox" title="Accept procedural fallback" checked={accepted} disabled={!!mapped} onChange={(e) => setPiece(sel, { acceptedFallbacks: e.target.checked ? [...piece.acceptedFallbacks, a] : piece.acceptedFallbacks.filter((x) => x !== a) })} />
                    </div>
                  );
                })}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Btn size="small" variant="ghost" onClick={() => setPiece(sel, { clipMap: { ...suggestClipMap(piece.stats.clips.map((c) => c.name)) } as CustomPiece['clipMap'] })}>Auto-map by name</Btn>
                <Btn size="small" variant="ghost" onClick={() => setPiece(sel, { acceptedFallbacks: REQUIRED_ACTIONS.filter((a) => !piece.clipMap[a]) })}>Accept fallbacks for required</Btn>
              </div>
            </div>
          </Panel>
        )}

        {tab === 'deaths' && piece && (
          <Panel title={`${sel} — deaths`}>
            <div className="col" style={{ gap: 6 }}>
              <div className="faint" style={{ fontSize: 12 }}>Pick every death this model can perform. The first is the default; the resolver weights the rest by attacker and blow.</div>
              {DEATH_TYPE_IDS.map((d) => {
                const on = piece.deaths.includes(d);
                const def = DEATH_TYPES[d];
                return (
                  <label key={d} className="row" style={{ gap: 8, cursor: 'pointer', opacity: on ? 1 : 0.7 }}>
                    <input type="checkbox" checked={on} onChange={(e) => setPiece(sel, { deaths: e.target.checked ? [...piece.deaths, d] : piece.deaths.filter((x) => x !== d) })} />
                    <b className="grow">{def.label}</b><span className="chip">{def.family}</span><span className="mono faint" style={{ fontSize: 11 }}>{def.duration}s</span>
                  </label>
                );
              })}
            </div>
          </Panel>
        )}
        {(tab === 'anims' || tab === 'deaths') && !piece && <Panel title={sel}><Empty onUpload={() => { pendingClass.current = sel; fileInput.current?.click(); }} /></Panel>}

        {tab === 'sequences' && (
          <Panel title="Kill sequences">
            <div className="col" style={{ gap: 8 }}>
              <div className="faint" style={{ fontSize: 12 }}>Author how each class fights. Without a bound sequence the class uses the standard finisher chain.</div>
              {PIECE_CLASSES.map((pc) => (
                <div key={pc} className="row" style={{ gap: 6 }}>
                  <span style={{ width: 70, textTransform: 'capitalize' }}>{GLYPHS[pc]} {pc}</span>
                  <select className="input grow" value={army.bindings[pc] ?? ''} onChange={(e) => setArmy({ ...army, bindings: e.target.value ? { ...army.bindings, [pc]: e.target.value } : Object.fromEntries(Object.entries(army.bindings).filter(([k]) => k !== pc)) })}>
                    <option value="">Standard finisher chain</option>
                    {army.sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              ))}
              <div className="divider" />
              <div className="row wrap" style={{ gap: 6 }}>
                {army.sequences.map((s) => <button key={s.id} className={`btn small ${seqId === s.id ? 'primary' : 'ghost'}`} onClick={() => setSeqId(s.id)}>{s.name}</button>)}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <select className="input grow" id="tmpl" defaultValue="">{finishersFor(sel).map((f) => <option key={f.id} value={f.id}>Template: {f.name}</option>)}</select>
                <Btn size="small" onClick={() => addSequence((document.getElementById('tmpl') as HTMLSelectElement).value)}>New for {sel}</Btn>
              </div>
              {sequence && <Btn size="small" variant="danger" onClick={() => { setArmy({ ...army, sequences: army.sequences.filter((s) => s.id !== sequence.id), bindings: Object.fromEntries(Object.entries(army.bindings).filter(([, v]) => v !== sequence.id)) }); setSeqId(null); }}>Delete “{sequence.name}”</Btn>}
            </div>
          </Panel>
        )}

        {tab === 'validate' && (
          <Panel title="Validation" right={<span className={`chip ${localValidation.pub.ok ? 'green' : 'red'}`}>{localValidation.pub.ok ? 'ready for online' : 'not ready'}</span>}>
            <div className="col" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="chip">{localValidation.priv.ok ? '✓ private/local play' : '✗ private/local play'}</span>
                <span className="chip">{localValidation.pub.ok ? '✓ public matchmaking' : '✗ public matchmaking'}</span>
              </div>
              {perf && <div className="mono" style={{ fontSize: 12 }}>Perf test (32 animated pieces): <b className={perf.fps >= 55 ? 'green' : perf.fps >= 40 ? 'amber' : 'red'}>{perf.fps} fps (p10)</b> · {perf.tris.toLocaleString()} tris · {perf.calls} draw calls</div>}
              {localValidation.pub.issues.length === 0 && <div className="green">All checks passed.</div>}
              {localValidation.pub.issues.map((i, k) => (
                <div key={k} className="row" style={{ gap: 8, fontSize: 13, alignItems: 'flex-start' }}>
                  <span className={`chip ${i.severity === 'error' ? 'red' : 'amber'}`} style={{ flex: 'none' }}>{i.severity}</span>
                  {i.piece && <b style={{ textTransform: 'capitalize', flex: 'none' }}>{i.piece}</b>}
                  <span className="dim">{i.message}</span>
                </div>
              ))}
              {serverIssues && <div className="faint" style={{ fontSize: 12 }}>Server re-measured the uploaded models: {serverIssues.filter((i) => i.severity === 'error').length} errors.</div>}
            </div>
          </Panel>
        )}
      </div>

      {/* ------------------------------------------------ bottom: sequence timeline + board preview */}
      {tab === 'sequences' && sequence && (
        <div className="pe-auto" style={{ position: 'absolute', left: 346, right: 18, bottom: 18 }}>
          <section className="panel">
            <div className="panel-body col" style={{ gap: 8 }}>
              <KillSequenceEditor sequence={sequence} onChange={updateSequence} playhead={playhead} />
              <CombatLab embedded sequence={sequence} onTime={setPlayhead}
                force={{ attackerFaction: factionId, attackerClass: sel, defenderFaction: army.doctrine === 'machines' ? 'remnants' : 'machines', defenderClass: 'pawn', version: previewVersion }} />
            </div>
          </section>
        </div>
      )}

      {busy && <div className="pe-auto modal-back" style={{ background: 'rgba(5,4,3,0.4)' }}><div className="panel" style={{ padding: 20 }}><div className="row"><div className="spin" style={{ width: 16, height: 16, border: '2px solid var(--amber)', borderTopColor: 'transparent', borderRadius: '50%' }} />{busy}</div></div></div>}
    </div>
  );
}

function Empty({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="col" style={{ alignItems: 'center', gap: 10, padding: 20, textAlign: 'center' }}>
      <div className="dim">No model assigned. Upload a GLB, GLTF (+ .bin + textures), FBX, OBJ (+ .mtl) or a ZIP package.</div>
      <Btn variant="primary" onClick={onUpload}>Upload model</Btn>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="mono faint" style={{ width: 70, fontSize: 11 }}>{label}</span>
      <input type="range" className="grow" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input className="input mono" style={{ width: 76, padding: '3px 6px', fontSize: 12 }} value={Number(value.toFixed(4))} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </div>
  );
}

void Seg; void THREE;
