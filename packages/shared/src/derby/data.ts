// Wasteland Derby — static data shared by server (simulation, betting) and
// client (race card, track rendering). Players never touch the race: they
// bet, and they can secretly buy horse upgrades or jockey perks.

import type { BuiltinFactionId } from '../types.js';

// ------------------------------------------------------------------ track
/** Stadium-shaped oval. Units match the board scene (1 unit ~ 2 m). */
export const TRACK = {
  straight: 48,
  radius: 16,
  /** Lateral spacing between racing lines. */
  laneWidth: 0.95,
  lanes: 8,
  /** Lap positions (along the rail line, from the start of the home straight) of the gates and the finish post. */
  startAt: 6,
  finishAt: 42,
} as const;

/** Length of one lap along the rail line. */
export const TRACK_LAP = 2 * TRACK.straight + 2 * Math.PI * TRACK.radius;
/** Race distance: away from the stands, once round, and home in front of them. */
export const RACE_DISTANCE = Math.round(TRACK_LAP + TRACK.finishAt - TRACK.startAt);

/** Phase lengths of the race cycle (ms). */
export const DERBY_TIMING = {
  betting: 45_000,
  /** Gates load after betting closes, before the off. */
  gates: 4_000,
  /** Shown after the last finisher before the next card opens. */
  results: 14_000,
} as const;

export const DERBY_START_CREDITS = 5000;
/** Bankrupt players get topped back up to this after a race. */
export const DERBY_STIPEND = 500;
export const DERBY_STAKES = { min: 10, max: 2500 } as const;
export const DERBY_FIELD = 8;

// ------------------------------------------------------------------ weapons
export type DerbyWeaponId = 'pipe' | 'chain' | 'shotgun' | 'crossbow' | 'flare_gun' | 'cattle_prod';
export type DerbyEffect = 'stagger' | 'knock' | 'slow' | 'burn';

export interface DerbyWeaponDef {
  id: DerbyWeaponId;
  name: string;
  /** Max distance (track units, along + across) at which the jockey can use it. */
  range: number;
  damage: number;
  /** Seconds between uses. */
  cooldown: number;
  /** Base hit chance. */
  accuracy: number;
  effect: DerbyEffect;
  ranged: boolean;
}

export const DERBY_WEAPONS: Record<DerbyWeaponId, DerbyWeaponDef> = {
  pipe:        { id: 'pipe', name: 'Lead Pipe', range: 1.6, damage: 14, cooldown: 2.6, accuracy: 0.62, effect: 'stagger', ranged: false },
  chain:       { id: 'chain', name: 'Tow Chain', range: 2.3, damage: 11, cooldown: 3.0, accuracy: 0.58, effect: 'knock', ranged: false },
  shotgun:     { id: 'shotgun', name: 'Sawn-off', range: 3.6, damage: 18, cooldown: 4.4, accuracy: 0.5, effect: 'stagger', ranged: true },
  crossbow:    { id: 'crossbow', name: 'Rebar Crossbow', range: 6.0, damage: 13, cooldown: 4.0, accuracy: 0.46, effect: 'slow', ranged: true },
  flare_gun:   { id: 'flare_gun', name: 'Flare Gun', range: 5.0, damage: 8, cooldown: 5.0, accuracy: 0.52, effect: 'burn', ranged: true },
  cattle_prod: { id: 'cattle_prod', name: 'Cattle Prod', range: 1.4, damage: 10, cooldown: 2.2, accuracy: 0.7, effect: 'slow', ranged: false },
};

// ------------------------------------------------------------------ upgrades (secret purchases)
export type DerbyUpgradeId =
  | 'nitro_oats' | 'plated_barding' | 'iron_lungs' | 'spiked_shoes'
  | 'scattergun' | 'smoke_bombs' | 'grapple_hook' | 'field_medic' | 'trick_rider';

export interface DerbyUpgradeDef {
  id: DerbyUpgradeId;
  name: string;
  target: 'horse' | 'jockey';
  cost: number;
  description: string;
}

export const DERBY_UPGRADES: Record<DerbyUpgradeId, DerbyUpgradeDef> = {
  nitro_oats:     { id: 'nitro_oats', name: 'Nitro Oats', target: 'horse', cost: 120, description: 'One violent burst of speed when the horse is behind in the home stretch.' },
  plated_barding: { id: 'plated_barding', name: 'Plated Barding', target: 'horse', cost: 90, description: 'Scrap-steel plates: incoming damage cut by a third.' },
  iron_lungs:     { id: 'iron_lungs', name: 'Iron Lungs', target: 'horse', cost: 100, description: 'Bellows rig. Stamina drains 30% slower — strong late.' },
  spiked_shoes:   { id: 'spiked_shoes', name: 'Spiked Shoes', target: 'horse', cost: 70, description: 'Better grip: shrugs off stumbles and kicks back at close attackers.' },
  scattergun:     { id: 'scattergun', name: 'Scattergun Rounds', target: 'jockey', cost: 80, description: "Jockey's weapon hits 40% harder and reaches a little further." },
  smoke_bombs:    { id: 'smoke_bombs', name: 'Smoke Bombs', target: 'jockey', cost: 60, description: 'When attacked, a smoke screen makes the next shots likely to miss.' },
  grapple_hook:   { id: 'grapple_hook', name: 'Grapple Hook', target: 'jockey', cost: 110, description: 'Once, late on: hook the horse ahead and slingshot past it.' },
  field_medic:    { id: 'field_medic', name: 'Field Medic Kit', target: 'jockey', cost: 50, description: 'Patches the horse up once when it is badly hurt.' },
  trick_rider:    { id: 'trick_rider', name: 'Trick Rider', target: 'jockey', cost: 75, description: 'Acrobatic jockey: dodges a quarter of incoming attacks.' },
};
export const DERBY_UPGRADE_IDS = Object.keys(DERBY_UPGRADES) as DerbyUpgradeId[];

// ------------------------------------------------------------------ roster
export interface DerbyStats {
  /** 1–10 each. */
  speed: number;
  stamina: number;
  grit: number;
  aggression: number;
  accuracy: number;
}

export interface DerbyHorseDef {
  id: string;
  horse: string;
  jockey: string;
  faction: BuiltinFactionId;
  /** Which side tint of the faction's knight model to use (variety between same-faction runners). */
  tint: 'w' | 'b';
  silks: string;
  weapon: DerbyWeaponId;
  stats: DerbyStats;
}

export const DERBY_ROSTER: DerbyHorseDef[] = [
  { id: 'h01', horse: 'Rust Bucket', jockey: 'Mags Holloway', faction: 'remnants', tint: 'w', silks: '#c8a050', weapon: 'shotgun', stats: { speed: 7, stamina: 6, grit: 6, aggression: 6, accuracy: 6 } },
  { id: 'h02', horse: 'Dust Devil', jockey: 'Kit Calloway', faction: 'wastelanders', tint: 'w', silks: '#d06a2a', weapon: 'chain', stats: { speed: 8, stamina: 5, grit: 5, aggression: 8, accuracy: 4 } },
  { id: 'h03', horse: 'Ironhoof', jockey: 'Unit 7-Kilo', faction: 'machines', tint: 'w', silks: '#e0702a', weapon: 'cattle_prod', stats: { speed: 6, stamina: 9, grit: 8, aggression: 4, accuracy: 7 } },
  { id: 'h04', horse: 'Glowing Ember', jockey: 'Dr. Ines Vael', faction: 'vault', tint: 'w', silks: '#3ad0e0', weapon: 'flare_gun', stats: { speed: 7, stamina: 7, grit: 5, aggression: 5, accuracy: 8 } },
  { id: 'h05', horse: 'Last Ration', jockey: 'Old Pike', faction: 'remnants', tint: 'b', silks: '#7a8a50', weapon: 'crossbow', stats: { speed: 5, stamina: 8, grit: 7, aggression: 5, accuracy: 9 } },
  { id: 'h06', horse: 'Cinder Queen', jockey: 'Ash Moreno', faction: 'wastelanders', tint: 'b', silks: '#a02a1a', weapon: 'pipe', stats: { speed: 9, stamina: 4, grit: 6, aggression: 9, accuracy: 3 } },
  { id: 'h07', horse: 'Overclock', jockey: 'Unit 0-Zero', faction: 'machines', tint: 'b', silks: '#ffb020', weapon: 'shotgun', stats: { speed: 8, stamina: 6, grit: 6, aggression: 7, accuracy: 5 } },
  { id: 'h08', horse: 'Fallout Boy', jockey: 'Teddy Rook', faction: 'vault', tint: 'b', silks: '#4a80d0', weapon: 'cattle_prod', stats: { speed: 6, stamina: 7, grit: 9, aggression: 6, accuracy: 6 } },
  { id: 'h09', horse: 'Scrap Iron', jockey: 'Big Dell', faction: 'remnants', tint: 'w', silks: '#909090', weapon: 'chain', stats: { speed: 6, stamina: 6, grit: 9, aggression: 8, accuracy: 4 } },
  { id: 'h10', horse: 'Radwind', jockey: 'Juno Sparks', faction: 'wastelanders', tint: 'w', silks: '#e0c040', weapon: 'flare_gun', stats: { speed: 8, stamina: 7, grit: 4, aggression: 5, accuracy: 7 } },
  { id: 'h11', horse: 'Piston Pete', jockey: 'Unit 3-Echo', faction: 'machines', tint: 'w', silks: '#c04020', weapon: 'crossbow', stats: { speed: 7, stamina: 8, grit: 6, aggression: 4, accuracy: 8 } },
  { id: 'h12', horse: 'Clean Slate', jockey: 'Overseer Hale', faction: 'vault', tint: 'w', silks: '#e8e8f0', weapon: 'pipe', stats: { speed: 7, stamina: 6, grit: 7, aggression: 7, accuracy: 5 } },
  { id: 'h13', horse: 'Bad Water', jockey: 'Silas Crane', faction: 'remnants', tint: 'b', silks: '#406060', weapon: 'cattle_prod', stats: { speed: 8, stamina: 5, grit: 6, aggression: 6, accuracy: 6 } },
  { id: 'h14', horse: 'Widowmaker', jockey: 'Ruby Six', faction: 'wastelanders', tint: 'b', silks: '#601020', weapon: 'shotgun', stats: { speed: 7, stamina: 5, grit: 5, aggression: 10, accuracy: 6 } },
  { id: 'h15', horse: 'Tin Stallion', jockey: 'Unit 9-Lima', faction: 'machines', tint: 'b', silks: '#808060', weapon: 'chain', stats: { speed: 5, stamina: 10, grit: 8, aggression: 5, accuracy: 5 } },
  { id: 'h16', horse: 'Geiger', jockey: 'Pip Lantern', faction: 'vault', tint: 'b', silks: '#80e060', weapon: 'crossbow', stats: { speed: 9, stamina: 5, grit: 4, aggression: 4, accuracy: 8 } },
];
export const DERBY_ROSTER_BY_ID: Record<string, DerbyHorseDef> = Object.fromEntries(DERBY_ROSTER.map((h) => [h.id, h]));

export const DERBY_RACE_NAMES = [
  'Rust Bowl Stakes', 'Glass Desert Derby', 'Overpass Handicap', 'Fallout Mile', 'Scrapyard Sprint', 'Ashfall Cup',
  'Dead Reactor Plate', 'Iron Gate Classic', 'Mutant Maiden', 'Red Sky Invitational', 'Bunker Hill Trophy', 'Last Light Stakes',
];

// ------------------------------------------------------------------ race card, bets and timeline (wire types)
export type DerbyBetKind = 'win' | 'place' | 'show';
export const DERBY_BET_KINDS: { id: DerbyBetKind; name: string; places: number; hint: string }[] = [
  { id: 'win', name: 'Win', places: 1, hint: 'Must finish 1st' },
  { id: 'place', name: 'Place', places: 2, hint: 'Finishes 1st or 2nd' },
  { id: 'show', name: 'Show', places: 3, hint: 'Finishes in the top 3' },
];

export interface DerbyRunner extends DerbyHorseDef {
  /** Gate / saddle-cloth number, 1-based. */
  number: number;
  lane: number;
  /** Recent finishing positions, most recent last (e.g. "3-1-5"). */
  form: string;
  /** Decimal odds (stake × odds returned) per bet kind. */
  odds: Record<DerbyBetKind, number>;
}

export type DerbyPhase = 'betting' | 'gates' | 'racing' | 'results';

export interface DerbyBet { id: string; runnerId: string; kind: DerbyBetKind; stake: number; odds: number; payout?: number }
export interface DerbyPurchase { runnerId: string; upgradeId: DerbyUpgradeId }

export interface DerbyEvent {
  /** Seconds from the off. */
  t: number;
  kind: 'attack' | 'hit' | 'miss' | 'dodge' | 'boost' | 'smoke' | 'grapple' | 'stumble' | 'heal' | 'counter' | 'wipeout' | 'remount' | 'lead' | 'finish';
  runner: string;
  target?: string;
  weapon?: DerbyWeaponId;
  upgrade?: DerbyUpgradeId;
  damage?: number;
  place?: number;
}

export interface DerbyTimeline {
  raceId: string;
  /** Seconds per frame. */
  step: number;
  duration: number;
  runners: string[];
  /** frames[i] = flat [dist, lateral, hp, flags] × runners.length. flags: 1 staggered, 2 boosting, 4 smoke, 8 down. */
  frames: number[][];
  events: DerbyEvent[];
  finishOrder: string[];
  finishTimes: Record<string, number>;
}

export interface DerbyResultLine { runnerId: string; place: number; time: number }

export interface DerbySummary {
  raceId: string;
  number: number;
  name: string;
  phase: DerbyPhase;
  bettingClosesAt: number;
  startsAt: number;
  watchers: number;
  punters: string[];
}

export interface DerbyPunter { id: string; name: string; avatar: string; bets: number; bot?: boolean }

export interface DerbyState {
  raceId: string;
  number: number;
  name: string;
  phase: DerbyPhase;
  serverNow: number;
  bettingClosesAt: number;
  startsAt: number;
  endsAt: number | null;
  distance: number;
  runners: DerbyRunner[];
  credits: number;
  myBets: DerbyBet[];
  myUpgrades: DerbyPurchase[];
  /** How many secret upgrades have been bought on this race by anyone (not which). */
  secretUpgrades: number;
  /** Count of bettors (not stakes) per runner — the crowd's opinion. */
  backers: Record<string, number>;
  /** Every bet on the board, by runner: who backed it, how and for how much (bets are public; upgrades stay secret). */
  bookings: Record<string, { name: string; kind: DerbyBetKind; stake: number; you?: boolean }[]>;
  watchers: number;
  /** Everyone track-side right now (bet counts only; never what or how much). */
  punters: DerbyPunter[];
  timeline: DerbyTimeline | null;
  results: DerbyResultLine[] | null;
  /** After the race: every purchase that was made, revealed. */
  revealed: { runnerId: string; upgradeId: DerbyUpgradeId; buyer: string }[] | null;
  /** Net credits won this race (payouts − stakes − upgrades) for the viewer. */
  myNet: number | null;
  history: { number: number; name: string; winner: string; winnerName: string; odds: number }[];
}
