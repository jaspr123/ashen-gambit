import { create } from 'zustand';
import type { LobbySnapshot, MatchState, SelfProfile, GameModeId, TimeControl } from '@ashen/shared';

export type Screen = 'boot' | 'lobby' | 'loadout' | 'game' | 'profile' | 'replay' | 'army' | 'lab' | 'settings' | 'derby' | 'admin' | 'poker';

export interface Toast { id: number; kind: 'info' | 'warn' | 'error' | 'success'; text: string }
export interface IncomingChallenge { challengeId: string; from: { id: string; name: string; rating: number }; mode: GameModeId; timeControl: TimeControl }
export interface QueueState { state: 'idle' | 'searching' | 'found' | 'kotb'; kind?: 'quick' | 'kotb'; position?: number; since?: number; arenaId?: string }

interface AppState {
  screen: Screen;
  /** Where "back" goes from the loadout screen and similar sub-screens. */
  previous: Screen;
  connection: 'connecting' | 'online' | 'offline';
  latency: number;
  profile: SelfProfile | null;
  lobby: LobbySnapshot | null;
  queue: QueueState;
  challenges: IncomingChallenge[];
  privateCode: string | null;
  toasts: Toast[];
  /** Latest authoritative state for the online match being played or watched. */
  onlineMatch: MatchState | null;
  replayGameId: string | null;
  devPanel: boolean;
  /** What the loadout screen launches: an offline AI/local game, or just saves for online play. */
  pendingSession: 'online' | 'ai' | 'local';
  go(screen: Screen): void;
  toast(kind: Toast['kind'], text: string): void;
  dismiss(id: number): void;
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
  screen: 'boot',
  previous: 'lobby',
  connection: 'connecting',
  latency: 0,
  profile: null,
  lobby: null,
  queue: { state: 'idle' },
  challenges: [],
  privateCode: null,
  toasts: [],
  onlineMatch: null,
  replayGameId: null,
  devPanel: false,
  pendingSession: 'online',
  go: (screen) => set({ previous: get().screen, screen }),
  toast: (kind, text) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-4), { id, kind, text }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** Human-readable messages for server error codes. */
export function describeError(code: string): string {
  const map: Record<string, string> = {
    illegal_move: 'That move is not legal.', not_your_turn: 'Not your turn.', stale_ply: 'Board out of sync — resyncing.',
    already_playing: 'You are already in a match.', target_busy: 'That player is busy.', rate_limited: 'Slow down.',
    army_not_validated: 'Your custom army must pass validation before public matchmaking.', army_missing: 'Selected custom army no longer exists.',
    name_taken: 'That callsign is taken.', bad_code: 'No private match with that code.', not_authenticated: 'Not signed in yet.',
    finisher_locked: 'That finisher is still locked.', no_targets: 'No valid targets.', cooldown: 'Ability is cooling down.',
    already_seated: 'You already have a seat at a table.', table_full: 'That table is full.', not_seated: 'Sit down first.', cannot_check: 'You have to call or fold.',
    raise_too_small: 'That raise is too small.', not_enough_chips: 'You do not have that many chips.', no_hand: 'No hand in progress.',
    bad_admin_code: 'That admin code is not right.', not_audio: 'That file is not a supported audio format.', file_too_large: 'Audio files can be at most 30 MB.', forbidden: 'Admins only.',
    bad_credentials: 'Wrong callsign or password.', too_many_attempts: 'Too many attempts — try again in 10 minutes.', weak_password: 'Password must be at least 8 characters.',
    wrong_password: 'Current password is incorrect.', bad_name: 'Callsigns are 2–20 letters, numbers, spaces, dots or dashes.', server_unreachable: 'Cannot reach the server.',
    no_longer_waiting: 'That player is no longer waiting.', not_trackside: 'Go track-side first.',
    insufficient_credits: 'Not enough credits in your bank.', betting_closed: 'Betting has closed for this race.', race_closed: 'That race is over.',
    back_the_horse_first: 'Back the horse with a bet before paying for upgrades.', already_bought: 'You already bought that for this horse.',
    upgrade_limit: 'Four back-room deals per race, max.', bad_stake: 'Stake must be between 10 and 1000.', too_many_bets: 'Twelve bets per race, max.',
    no_charges: 'No charges left.', already_used_this_turn: 'You already used an ability this turn.', requires_piece: 'You need that piece on the board.',
  };
  const key = code.split(':')[0];
  return map[key] ?? code.replace(/_/g, ' ');
}
