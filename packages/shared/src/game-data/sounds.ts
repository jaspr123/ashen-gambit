// Sound catalogue. Every id is a hook: the AudioManager plays
// /assets/audio/<id>.ogg when present, otherwise a procedural placeholder
// synthesised from `synth`, so the game always has audio feedback.
export type AudioBus = 'music' | 'ambience' | 'sfx' | 'voice' | 'ui';

export interface SoundDef { id: string; bus: AudioBus; volume: number; synth: string }

export const SOUNDS: SoundDef[] = [
  { id: 'amb_wind', bus: 'ambience', volume: 0.35, synth: 'wind' },
  { id: 'amb_distant_explosion', bus: 'ambience', volume: 0.4, synth: 'boom_far' },
  { id: 'music_lobby', bus: 'music', volume: 0.3, synth: 'drone' },
  { id: 'step_boots', bus: 'sfx', volume: 0.4, synth: 'step' },
  { id: 'step_servo', bus: 'sfx', volume: 0.4, synth: 'servo' },
  { id: 'step_chains', bus: 'sfx', volume: 0.4, synth: 'chain' },
  { id: 'step_armor', bus: 'sfx', volume: 0.4, synth: 'clank' },
  { id: 'swing_light', bus: 'sfx', volume: 0.6, synth: 'whoosh' },
  { id: 'swing_heavy', bus: 'sfx', volume: 0.7, synth: 'whoosh_low' },
  { id: 'swing_hydraulic', bus: 'sfx', volume: 0.7, synth: 'hydraulic' },
  { id: 'swing_energy', bus: 'sfx', volume: 0.6, synth: 'zap' },
  { id: 'hit_flesh', bus: 'sfx', volume: 0.8, synth: 'thud' },
  { id: 'hit_metal', bus: 'sfx', volume: 0.8, synth: 'clang' },
  { id: 'hit_energy', bus: 'sfx', volume: 0.8, synth: 'zap_hit' },
  { id: 'block', bus: 'sfx', volume: 0.7, synth: 'clang' },
  { id: 'gunshot', bus: 'sfx', volume: 0.8, synth: 'gun' },
  { id: 'gun_pistol', bus: 'sfx', volume: 0.8, synth: 'gun' },
  { id: 'gun_revolver', bus: 'sfx', volume: 0.85, synth: 'gun' },
  { id: 'gun_rifle', bus: 'sfx', volume: 0.85, synth: 'gun' },
  { id: 'gun_sniper', bus: 'sfx', volume: 0.9, synth: 'gun' },
  { id: 'gun_shotgun', bus: 'sfx', volume: 0.9, synth: 'gun' },
  { id: 'gun_smg', bus: 'sfx', volume: 0.8, synth: 'gun' },
  { id: 'crossbow_shot', bus: 'sfx', volume: 0.75, synth: 'whoosh' },
  { id: 'flare_shot', bus: 'sfx', volume: 0.8, synth: 'gun' },
  { id: 'swing_blade', bus: 'sfx', volume: 0.7, synth: 'whoosh' },
  { id: 'hit_blade', bus: 'sfx', volume: 0.8, synth: 'thud' },
  { id: 'hit_blunt', bus: 'sfx', volume: 0.85, synth: 'thud' },
  { id: 'hit_axe', bus: 'sfx', volume: 0.85, synth: 'thud' },
  { id: 'chain_whip', bus: 'sfx', volume: 0.75, synth: 'chain' },
  { id: 'electric_zap', bus: 'sfx', volume: 0.7, synth: 'zap_hit' },
  { id: 'derby_gallop', bus: 'ambience', volume: 0.5, synth: 'step' },
  { id: 'derby_crowd', bus: 'ambience', volume: 0.55, synth: 'wind' },
  { id: 'derby_fall', bus: 'sfx', volume: 0.85, synth: 'thud_heavy' },
  { id: 'energy_shot', bus: 'sfx', volume: 0.8, synth: 'laser' },
  { id: 'ground_slam', bus: 'sfx', volume: 0.9, synth: 'boom' },
  { id: 'crash', bus: 'sfx', volume: 0.9, synth: 'crash' },
  { id: 'execution', bus: 'sfx', volume: 0.9, synth: 'boom' },
  { id: 'fall_light', bus: 'sfx', volume: 0.6, synth: 'thud_soft' },
  { id: 'fall_body', bus: 'sfx', volume: 0.7, synth: 'thud_soft' },
  { id: 'fall_heavy', bus: 'sfx', volume: 0.8, synth: 'thud_heavy' },
  { id: 'servo_shutdown', bus: 'sfx', volume: 0.7, synth: 'powerdown' },
  { id: 'metal_collapse', bus: 'sfx', volume: 0.8, synth: 'crash' },
  { id: 'armor_fail', bus: 'sfx', volume: 0.7, synth: 'powerdown' },
  { id: 'debris', bus: 'sfx', volume: 0.8, synth: 'debris' },
  { id: 'ui_hover', bus: 'ui', volume: 0.2, synth: 'tick' },
  { id: 'ui_click', bus: 'ui', volume: 0.4, synth: 'click' },
  { id: 'ui_select', bus: 'ui', volume: 0.4, synth: 'blip' },
  { id: 'ui_error', bus: 'ui', volume: 0.4, synth: 'buzz' },
  { id: 'ui_match_found', bus: 'ui', volume: 0.6, synth: 'alert' },
  { id: 'check', bus: 'sfx', volume: 0.6, synth: 'alarm' },
  { id: 'ability', bus: 'sfx', volume: 0.7, synth: 'ability' },
  { id: 'mine_blast', bus: 'sfx', volume: 1.0, synth: 'boom' },
  { id: 'victory', bus: 'music', volume: 0.7, synth: 'victory' },
  { id: 'defeat', bus: 'music', volume: 0.7, synth: 'defeat' },
];
export const SOUNDS_BY_ID: Record<string, SoundDef> = Object.fromEntries(SOUNDS.map((s) => [s.id, s]));

/**
 * What each weapon sounds like. `fire` replaces generic gunshot/energy cues in
 * combat timelines; `swing` plays on attack actions; `hit` is the default impact.
 */
export const WEAPON_AUDIO: Record<string, { swing: string; hit: string; fire?: string }> = {
  knife:      { swing: 'swing_blade', hit: 'hit_blade' },
  chainblade: { swing: 'swing_blade', hit: 'hit_blade' },
  saw:        { swing: 'swing_hydraulic', hit: 'hit_blade' },
  claw:       { swing: 'swing_hydraulic', hit: 'hit_metal' },
  pipe:       { swing: 'swing_heavy', hit: 'hit_blunt' },
  baton:      { swing: 'swing_light', hit: 'electric_zap' },
  hammer:     { swing: 'swing_heavy', hit: 'hit_blunt' },
  staff:      { swing: 'swing_heavy', hit: 'hit_blunt' },
  lance:      { swing: 'swing_energy', hit: 'hit_energy' },
  axe:        { swing: 'swing_heavy', hit: 'hit_axe' },
  pistol:     { swing: 'swing_light', hit: 'hit_flesh', fire: 'gun_pistol' },
  revolver:   { swing: 'swing_light', hit: 'hit_flesh', fire: 'gun_revolver' },
  rifle:      { swing: 'swing_light', hit: 'hit_flesh', fire: 'gun_rifle' },
  smg:        { swing: 'swing_light', hit: 'hit_flesh', fire: 'gun_smg' },
  sniper:     { swing: 'swing_light', hit: 'hit_flesh', fire: 'gun_sniper' },
  shotgun:    { swing: 'swing_light', hit: 'hit_flesh', fire: 'gun_shotgun' },
  cannon:     { swing: 'swing_heavy', hit: 'hit_metal', fire: 'gun_shotgun' },
  energy:     { swing: 'swing_energy', hit: 'hit_energy', fire: 'energy_shot' },
  crossbow:   { swing: 'swing_light', hit: 'hit_blade', fire: 'crossbow_shot' },
};

/** Derby jockey weapons -> attack + hit sounds. */
export const DERBY_WEAPON_AUDIO: Record<string, { attack: string; hit: string }> = {
  pipe: { attack: 'swing_heavy', hit: 'hit_blunt' },
  chain: { attack: 'chain_whip', hit: 'hit_blunt' },
  shotgun: { attack: 'gun_shotgun', hit: 'hit_flesh' },
  crossbow: { attack: 'crossbow_shot', hit: 'hit_blade' },
  flare_gun: { attack: 'flare_shot', hit: 'hit_energy' },
  cattle_prod: { attack: 'electric_zap', hit: 'electric_zap' },
};
