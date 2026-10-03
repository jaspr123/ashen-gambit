import type { BuiltinFactionId, PieceClass, RigType } from '../types.js';
import type { DeathTypeId } from './deaths.js';

/** Visual + combat identity of one chess-piece class inside a faction. */
export interface FactionPieceDef {
  /** In-world unit name, e.g. "Scavenger" for the Wastelanders pawn. */
  unitName: string;
  description: string;
  rig: RigType;
  /** Death categories this model can perform; first is the default. */
  deaths: DeathTypeId[];
  /** Procedural body archetype used when no GLB model is available. */
  archetype: ProceduralArchetype;
  /** Optional GLB model path (relative to /assets). Replaces the procedural body when present. */
  model?: string;
  /** Mesh/variant name inside the faction GLB, if one GLB holds several characters. */
  variant?: string;
  /** Weapon carried in combat (drives sound + impact effect). */
  weapon: WeaponKind;
  /** Visual scale multiplier relative to standard piece height. */
  scale: number;
}

export type ProceduralArchetype =
  | 'soldier' | 'heavy' | 'rider' | 'mystic' | 'commander' | 'sovereign'
  | 'drone' | 'walker' | 'tank' | 'sentinel' | 'colossus' | 'overseer';

export type WeaponKind =
  | 'knife' | 'rifle' | 'pipe' | 'chainblade' | 'shotgun' | 'hammer' | 'lance'
  | 'claw' | 'saw' | 'cannon' | 'baton' | 'energy' | 'staff' | 'pistol'
  | 'revolver' | 'smg' | 'sniper' | 'axe' | 'crossbow';

export interface FactionDef {
  id: BuiltinFactionId;
  name: string;
  tagline: string;
  identity: 'reconnaissance' | 'defense' | 'aggression' | 'technology';
  lore: string;
  /** Palette: primary armor, secondary cloth/metal, accent (emissive), base pedestal. */
  palette: { primary: string; secondary: string; accent: string; base: string; dark: string };
  /** Faction-wide default material feel. */
  material: { metalness: number; roughness: number; wear: number };
  /** Optional faction GLB bundle (all six pieces + shared clips). */
  bundle?: string;
  pieces: Record<PieceClass, FactionPieceDef>;
  /** Faction-level generic capture timeline used by the fallback chain. */
  genericCapture: string;
  sounds: { move: string; attack: string; impact: string; death: string };
}

export const FACTIONS: Record<BuiltinFactionId, FactionDef> = {
  remnants: {
    id: 'remnants',
    name: 'The Remnants',
    tagline: 'What is left of the army still holds the line.',
    identity: 'reconnaissance',
    lore: 'Survivors of a collapsed military, held together by old chains of command, gas masks and whatever the depots still had on the shelves. They win by knowing more than you do.',
    palette: { primary: '#5b6340', secondary: '#3d3a2f', accent: '#e8b84a', base: '#2a2c24', dark: '#1a1b16' },
    material: { metalness: 0.25, roughness: 0.78, wear: 0.6 },
    bundle: 'factions/remnants.glb',
    genericCapture: 'faction_remnants_capture',
    sounds: { move: 'step_boots', attack: 'swing_light', impact: 'hit_flesh', death: 'fall_body' },
    pieces: {
      pawn: { unitName: 'Rifleman', description: 'Conscript in a cracked gas mask. Expendable, and knows it.', rig: 'humanoid', deaths: ['backward_collapse', 'kneel_and_fall', 'light_death'], archetype: 'soldier', weapon: 'rifle', scale: 0.82, variant: 'pawn' },
      knight: { unitName: 'Outrider', description: 'Fast scout who hits from angles nobody covers.', rig: 'humanoid', deaths: ['knockback_death', 'side_collapse'], archetype: 'rider', weapon: 'revolver', scale: 1.0, variant: 'knight' },
      bishop: { unitName: 'Signals Officer', description: 'Reads the battlefield like a map. Strikes along the diagonals of intel.', rig: 'humanoid', deaths: ['side_collapse', 'kneel_and_fall'], archetype: 'mystic', weapon: 'pistol', scale: 1.02, variant: 'bishop' },
      rook: { unitName: 'Bunker Gunner', description: 'Sandbag-armoured heavy weapons team.', rig: 'humanoid', deaths: ['heavy_death', 'backward_collapse'], archetype: 'heavy', weapon: 'shotgun', scale: 1.0, variant: 'rook' },
      queen: { unitName: 'Field Commander', description: 'The last officer anyone still salutes.', rig: 'humanoid', deaths: ['kneel_and_fall', 'backward_collapse'], archetype: 'commander', weapon: 'smg', scale: 1.1, variant: 'queen' },
      king: { unitName: 'The General', description: 'Old, scarred and impossible to replace.', rig: 'humanoid', deaths: ['kneel_and_fall', 'heavy_death'], archetype: 'sovereign', weapon: 'sniper', scale: 1.16, variant: 'king' },
    },
  },
  machines: {
    id: 'machines',
    name: 'The Machines',
    tagline: 'The factories never stopped. They just stopped taking orders.',
    identity: 'defense',
    lore: 'Construction rigs, loaders and military drones that kept running after their operators died. Armoured, patient and very hard to break.',
    palette: { primary: '#c98a1c', secondary: '#3b3e42', accent: '#ff5a1f', base: '#26282b', dark: '#141517' },
    material: { metalness: 0.75, roughness: 0.45, wear: 0.7 },
    bundle: 'factions/machines.glb',
    genericCapture: 'faction_machines_capture',
    sounds: { move: 'step_servo', attack: 'swing_hydraulic', impact: 'hit_metal', death: 'servo_shutdown' },
    pieces: {
      pawn: { unitName: 'Loader Drone', description: 'Bipedal cargo unit with a hydraulic clamp.', rig: 'mechanical', deaths: ['mechanical_shutdown', 'disassembly'], archetype: 'drone', weapon: 'knife', scale: 0.82, variant: 'pawn' },
      knight: { unitName: 'Strider', description: 'Leaping two-legged hunter frame.', rig: 'mechanical', deaths: ['mechanical_collapse', 'disassembly'], archetype: 'walker', weapon: 'chainblade', scale: 1.0, variant: 'knight' },
      bishop: { unitName: 'Survey Unit', description: 'Tall sensor mast with a cutting laser.', rig: 'mechanical', deaths: ['mechanical_shutdown', 'side_collapse'], archetype: 'sentinel', weapon: 'energy', scale: 1.02, variant: 'bishop' },
      rook: { unitName: 'Excavator', description: 'Treaded demolition machine with a pile-driver arm.', rig: 'mechanical', deaths: ['mechanical_collapse', 'heavy_death'], archetype: 'tank', weapon: 'energy', scale: 1.0, variant: 'rook' },
      queen: { unitName: 'Foundry Mother', description: 'Fabrication rig that builds as fast as it destroys.', rig: 'mechanical', deaths: ['disassembly', 'mechanical_collapse'], archetype: 'colossus', weapon: 'energy', scale: 1.1, variant: 'queen' },
      king: { unitName: 'Core Mainframe', description: 'Armoured logic core on legs. Everything else serves it.', rig: 'mechanical', deaths: ['mechanical_shutdown', 'disassembly'], archetype: 'overseer', weapon: 'chainblade', scale: 1.16, variant: 'king' },
    },
  },
  wastelanders: {
    id: 'wastelanders',
    name: 'The Wastelanders',
    tagline: 'Chains, road signs and bad intentions.',
    identity: 'aggression',
    lore: 'Highway raiders who weld their armour out of car doors and their weapons out of whatever is left. Loud, reckless and dangerously unpredictable.',
    palette: { primary: '#8a3b22', secondary: '#4a4038', accent: '#ffb02e', base: '#2d2420', dark: '#1a1411' },
    material: { metalness: 0.5, roughness: 0.7, wear: 0.9 },
    bundle: 'factions/wastelanders.glb',
    genericCapture: 'faction_wastelanders_capture',
    sounds: { move: 'step_chains', attack: 'swing_heavy', impact: 'hit_metal', death: 'fall_body' },
    pieces: {
      pawn: { unitName: 'Scavenger', description: 'Pipe, rags and nothing to lose.', rig: 'humanoid', deaths: ['knockback_death', 'side_collapse', 'light_death'], archetype: 'soldier', weapon: 'axe', scale: 0.82, variant: 'pawn' },
      knight: { unitName: 'Road Reaver', description: 'Bike-riding raider with a chain blade.', rig: 'humanoid', deaths: ['knockback_death', 'side_collapse'], archetype: 'rider', weapon: 'revolver', scale: 1.0, variant: 'knight' },
      bishop: { unitName: 'Rust Prophet', description: 'Preaches the end of the world with a sign-post staff.', rig: 'humanoid', deaths: ['kneel_and_fall', 'side_collapse'], archetype: 'mystic', weapon: 'knife', scale: 1.02, variant: 'bishop' },
      rook: { unitName: 'Wrecker', description: 'Walking scrapyard with a car-door shield and a sledge.', rig: 'humanoid', deaths: ['heavy_death', 'backward_collapse'], archetype: 'heavy', weapon: 'shotgun', scale: 1.0, variant: 'rook' },
      queen: { unitName: 'Warlord Queen', description: 'Rules the highway. Takes what she wants.', rig: 'humanoid', deaths: ['kneel_and_fall', 'knockback_death'], archetype: 'commander', weapon: 'rifle', scale: 1.1, variant: 'queen' },
      king: { unitName: 'Scrap King', description: 'Crowned in hubcaps, throned on a pile of wrecks.', rig: 'humanoid', deaths: ['heavy_death', 'kneel_and_fall'], archetype: 'sovereign', weapon: 'axe', scale: 1.16, variant: 'king' },
    },
  },
  vault: {
    id: 'vault',
    name: 'The Vault',
    tagline: 'Sealed in 2031. Opened when it suited them.',
    identity: 'technology',
    lore: 'Descendants of a sealed underground facility, fielding clean but ageing powered armour and experimental tech they barely understand.',
    palette: { primary: '#d9dde0', secondary: '#2d4f73', accent: '#39d0ff', base: '#1f2a33', dark: '#11171c' },
    material: { metalness: 0.55, roughness: 0.35, wear: 0.25 },
    bundle: 'factions/vault.glb',
    genericCapture: 'faction_vault_capture',
    sounds: { move: 'step_armor', attack: 'swing_energy', impact: 'hit_energy', death: 'armor_fail' },
    pieces: {
      pawn: { unitName: 'Vault Trooper', description: 'Sealed-suit infantry with a shock baton.', rig: 'humanoid', deaths: ['backward_collapse', 'kneel_and_fall'], archetype: 'soldier', weapon: 'pistol', scale: 0.82, variant: 'pawn' },
      knight: { unitName: 'Jump Trooper', description: 'Thruster pack, arcing leaps, energy lance.', rig: 'humanoid', deaths: ['knockback_death', 'side_collapse'], archetype: 'rider', weapon: 'smg', scale: 1.0, variant: 'knight' },
      bishop: { unitName: 'Overseer Tech', description: 'Field scientist with a prototype emitter.', rig: 'humanoid', deaths: ['side_collapse', 'kneel_and_fall'], archetype: 'mystic', weapon: 'pistol', scale: 1.02, variant: 'bishop' },
      rook: { unitName: 'Bulwark Armour', description: 'Full powered armour with a hydraulic fist.', rig: 'humanoid', deaths: ['heavy_death', 'backward_collapse'], archetype: 'heavy', weapon: 'rifle', scale: 1.0, variant: 'rook' },
      queen: { unitName: 'Director', description: 'Commands the vault and its prototype arsenal.', rig: 'humanoid', deaths: ['kneel_and_fall', 'backward_collapse'], archetype: 'commander', weapon: 'revolver', scale: 1.1, variant: 'queen' },
      king: { unitName: 'The Overseer', description: 'Has not seen the sun in forty years and does not miss it.', rig: 'humanoid', deaths: ['kneel_and_fall', 'heavy_death'], archetype: 'sovereign', weapon: 'smg', scale: 1.16, variant: 'king' },
    },
  },
};

export const FACTION_IDS = Object.keys(FACTIONS) as BuiltinFactionId[];

export function isBuiltinFaction(id: string): id is BuiltinFactionId {
  return id in FACTIONS;
}
