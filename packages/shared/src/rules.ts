// Game-rules abstraction: chess and Battle Checkers share one engine surface
// so matches, bots, replays, the HUD and the combat system work with either.
import type { BuiltinFactionId, Color, GameModeId, GameResult, MoveRecord, PieceType, Square } from './types.js';
import { ChessEngine, type EngineSnapshot } from './chess/engine.js';
import { CheckersEngine, type CheckersSnapshot } from './checkers/engine.js';
import { ArcadeEngine, type ArcadeSnapshot } from './arcade/engine.js';
import { GAME_MODES } from './game-data/gameModes.js';

/** Move shape shared by chess.js verbose moves and checkers moves. */
export interface RulesMove {
  color: Color;
  from: Square | string;
  to: Square | string;
  piece: PieceType | string;
  captured?: PieceType | string;
  promotion?: PieceType | string;
  flags: string;
  san: string;
  /** Square of the captured piece when it differs from `to` (checkers jumps, en passant). */
  captureSquare?: Square;
}

export type RulesEngine = ChessEngine | CheckersEngine | ArcadeEngine;
export type RulesKind = 'chess' | 'checkers' | 'arcade';

export function rulesOf(mode: GameModeId): RulesKind { return GAME_MODES[mode]?.rules ?? 'chess'; }

export function createEngine(mode: GameModeId, opts: { fen?: string; war?: { w: BuiltinFactionId; b: BuiltinFactionId } | null } = {}): RulesEngine {
  const r = rulesOf(mode);
  if (r === 'checkers') return new CheckersEngine({ fen: opts.fen });
  if (r === 'arcade') return new ArcadeEngine({ fen: opts.fen });
  return new ChessEngine({ fen: opts.fen, war: opts.war });
}

export function restoreEngine(s: EngineSnapshot | CheckersSnapshot | ArcadeSnapshot): RulesEngine {
  if ((s as ArcadeSnapshot).kind === 'arcade') return ArcadeEngine.restore(s as ArcadeSnapshot);
  return (s as CheckersSnapshot).kind === 'checkers' ? CheckersEngine.restore(s as CheckersSnapshot) : ChessEngine.restore(s as EngineSnapshot);
}

export type { GameResult, MoveRecord };
