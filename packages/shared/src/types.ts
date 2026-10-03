// Core domain types shared by client and server.

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Square = `${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h'}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

export const PIECE_TYPES: PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];
export const PIECE_NAMES: Record<PieceType, string> = {
  p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King',
};
export const PIECE_KEYS: Record<PieceType, PieceClass> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};
export type PieceClass = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export const CLASS_TO_TYPE: Record<PieceClass, PieceType> = {
  pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k',
};

export type BuiltinFactionId = 'remnants' | 'machines' | 'wastelanders' | 'vault';
/** Built-in faction id, or `custom:<armyId>` for user-created armies. */
export type FactionId = BuiltinFactionId | `custom:${string}`;

export type GameModeId = 'standard' | 'war' | 'kotb' | 'checkers' | 'arcade';
export type AbilityVisibility = 'off' | 'visible' | 'secret';

export interface TimeControl {
  /** Base minutes; 0 = untimed. */
  minutes: number;
  incrementSec: number;
}

export type RigType = 'humanoid' | 'mechanical' | 'vehicle' | 'creature' | 'static';

export type PlayerStatus = 'idle' | 'queued' | 'playing' | 'spectating' | 'away';

export type GameResultReason =
  | 'checkmate' | 'stalemate' | 'resign' | 'timeout' | 'abandon'
  | 'threefold' | 'fifty_move' | 'insufficient' | 'agreement' | 'aborted';

export interface GameResult {
  winner: Color | null;
  reason: GameResultReason;
}

export interface FinisherSelection {
  pawn: string;
  knight: string;
  bishop: string;
  rook: string;
  queen: string;
  king: string;
}

export interface Loadout {
  faction: FactionId;
  mode: GameModeId;
  finishers: FinisherSelection;
  timeControl: TimeControl;
  abilityVisibility: AbilityVisibility;
}

export interface MoveRecord {
  ply: number;
  san: string;
  from: Square;
  to: Square;
  color: Color;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  flags: string;
  fenAfter: string;
  /** Combat sequence id used to animate this capture (for replays). */
  combatId?: string;
  /** Ability activated on this ply, if any. */
  ability?: string;
  /** Milliseconds left on mover's clock after the move. */
  clockMs?: number;
  at: number;
  /** Square of the captured piece when it is not `to` (checkers jumps). */
  captureSquare?: Square;
  /** Extra board edits caused by abilities (mines, swaps...). */
  effects?: BoardEffect[];
}

export type BoardEffect =
  | { type: 'remove'; square: Square; cause: string }
  | { type: 'relocate'; from: Square; to: Square; cause: string }
  | { type: 'swap'; a: Square; b: Square; cause: string };

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string;
  rating: number;
  status: PlayerStatus;
  faction?: FactionId;
  bot?: boolean;
  matchId?: string;
}
