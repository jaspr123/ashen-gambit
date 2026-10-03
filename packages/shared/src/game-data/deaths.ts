// Reusable death categories. Every piece maps to one or more of these.
// Skeletal models play the mapped clip; everything else uses the procedural
// recipe below, so a death always exists even for a static uploaded mesh.

export const DEATH_TYPE_IDS = [
  'light_death', 'medium_death', 'heavy_death', 'knockback_death',
  'mechanical_shutdown', 'mechanical_collapse', 'disassembly',
  'kneel_and_fall', 'backward_collapse', 'side_collapse',
] as const;
export type DeathTypeId = (typeof DEATH_TYPE_IDS)[number];

export interface DeathTypeDef {
  id: DeathTypeId;
  label: string;
  family: 'organic' | 'mechanical' | 'armored' | 'any';
  /** Seconds until the body is at rest (the death pose). */
  duration: number;
  /** Seconds the corpse lingers before fading out. */
  linger: number;
  /** Animation action requested from the model's clip mapping. */
  action: 'DEATH_LIGHT' | 'DEATH_HEAVY' | 'DEATH_KNOCKBACK' | 'DEATH_MECHANICAL';
  procedural: {
    /** Direction relative to the hit: back = away from attacker. */
    fall: 'back' | 'forward' | 'side' | 'down' | 'none';
    /** Drop to knees first (fraction of duration). */
    kneel?: number;
    /** Horizontal slide distance in board squares. */
    slide?: number;
    /** Initial upward pop (knockback). */
    pop?: number;
    /** Split the model into parts and scatter them. */
    breakApart?: boolean;
    /** Sparks / smoke while dying. */
    sparks?: boolean;
    smoke?: boolean;
    /** Shaking/twitching before collapse (servo failure). */
    twitch?: number;
    /** Visual emissive shutdown (lights fade). */
    powerDown?: boolean;
  };
  sound: string;
}

export const DEATH_TYPES: Record<DeathTypeId, DeathTypeDef> = {
  light_death: { id: 'light_death', label: 'Light Death', family: 'any', duration: 0.9, linger: 1.2, action: 'DEATH_LIGHT', procedural: { fall: 'back', slide: 0.1 }, sound: 'fall_light' },
  medium_death: { id: 'medium_death', label: 'Medium Death', family: 'any', duration: 1.1, linger: 1.2, action: 'DEATH_LIGHT', procedural: { fall: 'side', slide: 0.15 }, sound: 'fall_body' },
  heavy_death: { id: 'heavy_death', label: 'Heavy Collapse', family: 'armored', duration: 1.4, linger: 1.4, action: 'DEATH_HEAVY', procedural: { fall: 'forward', kneel: 0.45, slide: 0.05, smoke: true }, sound: 'fall_heavy' },
  knockback_death: { id: 'knockback_death', label: 'Knockback', family: 'any', duration: 1.0, linger: 1.2, action: 'DEATH_KNOCKBACK', procedural: { fall: 'back', pop: 0.45, slide: 0.7 }, sound: 'fall_body' },
  mechanical_shutdown: { id: 'mechanical_shutdown', label: 'Servo Shutdown', family: 'mechanical', duration: 1.5, linger: 1.3, action: 'DEATH_MECHANICAL', procedural: { fall: 'down', twitch: 0.5, sparks: true, powerDown: true }, sound: 'servo_shutdown' },
  mechanical_collapse: { id: 'mechanical_collapse', label: 'Mechanical Collapse', family: 'mechanical', duration: 1.3, linger: 1.3, action: 'DEATH_MECHANICAL', procedural: { fall: 'side', twitch: 0.25, sparks: true, smoke: true, powerDown: true }, sound: 'metal_collapse' },
  disassembly: { id: 'disassembly', label: 'Disassembly', family: 'mechanical', duration: 1.4, linger: 1.0, action: 'DEATH_MECHANICAL', procedural: { fall: 'none', breakApart: true, sparks: true, smoke: true, powerDown: true }, sound: 'debris' },
  kneel_and_fall: { id: 'kneel_and_fall', label: 'Kneel and Fall', family: 'organic', duration: 1.6, linger: 1.3, action: 'DEATH_HEAVY', procedural: { fall: 'forward', kneel: 0.55 }, sound: 'fall_body' },
  backward_collapse: { id: 'backward_collapse', label: 'Backward Collapse', family: 'organic', duration: 1.1, linger: 1.2, action: 'DEATH_LIGHT', procedural: { fall: 'back', slide: 0.2 }, sound: 'fall_body' },
  side_collapse: { id: 'side_collapse', label: 'Side Collapse', family: 'organic', duration: 1.15, linger: 1.2, action: 'DEATH_LIGHT', procedural: { fall: 'side', slide: 0.1 }, sound: 'fall_body' },
};

