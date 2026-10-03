import { useApp } from '../../core/store';
import { useSettings, type GraphicsPreset } from '../../core/settings';
import { Btn, Panel, Seg } from '../common';
import { TopBar } from '../TopBar';

export function SettingsScreen() {
  const s = useSettings();
  const previous = useApp((x) => x.previous);
  const go = useApp((x) => x.go);
  const back = () => go(previous === 'settings' ? 'lobby' : previous);
  const slider = (label: string, value: number, onChange: (v: number) => void, min = 0, max = 1, step = 0.01) => (
    <div className="field"><label>{label} <span className="mono amber">{Math.round(value * 100) / 100}</span></label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>
  );
  const toggle = (label: string, value: boolean, onChange: (v: boolean) => void) => (
    <label className="row" style={{ cursor: 'pointer', gap: 10 }}><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
  );
  const g = s.graphics;
  return (
    <div className="screen" style={{ background: 'rgba(8,6,4,0.5)' }}>
      <TopBar back={back} title="Settings" />
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 420px))', justifyContent: 'center', gap: 16, padding: '6px 20px 20px', minHeight: 0 }} className="scroll">
        <Panel title="Graphics">
          <div className="col" style={{ gap: 12 }}>
            <Seg<GraphicsPreset> value={g.preset} onChange={s.setPreset} options={(['low', 'medium', 'high', 'ultra'] as GraphicsPreset[]).map((p) => ({ value: p, label: p }))} />
            <div className="field"><label>Shadows</label><Seg value={g.shadows} onChange={(v) => s.setGraphics({ shadows: v })} options={[0, 1024, 2048, 4096].map((v) => ({ value: v as 0, label: v ? `${v}` : 'Off' }))} /></div>
            <div className="field"><label>Post-processing</label><Seg value={g.postprocessing} onChange={(v) => s.setGraphics({ postprocessing: v })} options={[{ value: 0 as const, label: 'Off' }, { value: 1 as const, label: 'Bloom' }, { value: 2 as const, label: 'Full' }]} /></div>
            <div className="field"><label>Texture quality</label><Seg value={g.textureSize} onChange={(v) => s.setGraphics({ textureSize: v })} options={[256, 512, 1024, 2048].map((v) => ({ value: v as 256, label: String(v) }))} /></div>
            {slider('Particles', g.particles, (v) => s.setGraphics({ particles: v }), 0, 2, 0.05)}
            {slider('Environment detail', g.environmentDetail, (v) => s.setGraphics({ environmentDetail: v }), 0.2, 1.5, 0.05)}
            {slider('Resolution scale (DPR)', g.dpr, (v) => s.setGraphics({ dpr: v }), 0.75, 2, 0.25)}
            <div className="field"><label>Animation quality</label><Seg value={g.animationQuality} onChange={(v) => s.setGraphics({ animationQuality: v })} options={[{ value: 'low' as const, label: 'Low' }, { value: 'high' as const, label: 'High' }]} /></div>
            <div className="faint" style={{ fontSize: 12 }}>Texture quality and environment detail apply to newly loaded arenas.</div>
          </div>
        </Panel>
        <Panel title="Audio">
          <div className="col" style={{ gap: 12 }}>
            {toggle('Mute all', s.audio.muted, (v) => s.setAudio({ muted: v }))}
            {slider('Master', s.audio.master, (v) => s.setAudio({ master: v }))}
            {slider('Music', s.audio.music, (v) => s.setAudio({ music: v }))}
            {slider('Ambience', s.audio.ambience, (v) => s.setAudio({ ambience: v }))}
            {slider('Effects', s.audio.sfx, (v) => s.setAudio({ sfx: v }))}
            {slider('Voice', s.audio.voice, (v) => s.setAudio({ voice: v }))}
            {slider('Interface', s.audio.ui, (v) => s.setAudio({ ui: v }))}
          </div>
        </Panel>
        <Panel title="Gameplay">
          <div className="col" style={{ gap: 12 }}>
            <div className="field"><label>Fight playback</label><Seg value={s.combatSpeed} onChange={(v) => s.set({ combatSpeed: v })} options={[{ value: 1, label: 'Normal' }, { value: 1.5, label: '1.5×' }, { value: 2, label: '2×' }, { value: 0, label: 'Off' }]} /></div>
            {slider('Camera sensitivity', s.cameraSensitivity, (v) => s.set({ cameraSensitivity: v }), 0.3, 2.5, 0.1)}
            {toggle('Show legal moves', s.showLegalMoves, (v) => s.set({ showLegalMoves: v }))}
            {toggle('Show board coordinates', s.showCoordinates, (v) => s.set({ showCoordinates: v }))}
            {toggle('Always promote to queen', s.autoQueen, (v) => s.set({ autoQueen: v }))}
            {toggle('Show FPS counter', s.showFps, (v) => s.set({ showFps: v }))}
            <div className="divider" />
            <div className="eyebrow">Controls</div>
            <div className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
              Left-click: select / move · Right-drag: orbit · Shift-drag: pan · Wheel: zoom<br />
              Q / E: rotate · R / F: tilt · Space: skip fight · Esc: cancel · ` : dev panel
            </div>
            <Btn variant="ghost" onClick={back}>Done</Btn>
          </div>
        </Panel>
      </div>
    </div>
  );
}
