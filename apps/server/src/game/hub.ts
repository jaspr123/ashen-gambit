import type { S2CEvents } from '@ashen/shared';

/** Thin transport abstraction so game logic never touches Socket.IO directly. */
export interface Hub {
  emitUser<E extends keyof S2CEvents>(userId: string, event: E, ...args: Parameters<S2CEvents[E]>): void;
  emitRoom<E extends keyof S2CEvents>(room: string, event: E, ...args: Parameters<S2CEvents[E]>): void;
  emitAll<E extends keyof S2CEvents>(event: E, ...args: Parameters<S2CEvents[E]>): void;
  joinRoom(userId: string, room: string): void;
  leaveRoom(userId: string, room: string): void;
  isOnline(userId: string): boolean;
}

export const spectatorRoom = (matchId: string) => `spect:${matchId}`;
