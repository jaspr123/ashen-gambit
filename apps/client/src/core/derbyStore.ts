// Wasteland Derby client state: the server's per-viewer race view plus local
// viewing preferences (camera, selected runner). The server clock offset lets
// every client replay the shared race timeline in sync.

import { create } from 'zustand';
import type { DerbyState } from '@ashen/shared';

export type DerbyCam = 'auto' | 'follow' | 'aerial';

interface DerbyStore {
  state: DerbyState | null;
  /** serverNow − Date.now() at the last update. */
  offset: number;
  selected: string | null;
  cam: DerbyCam;
  /** Panels collapsed so the race fills the screen. */
  focus: boolean;
  setFocus(f: boolean): void;
  chat: { from: string; name: string; text: string; at: number }[];
  receive(s: DerbyState): void;
  pushChat(m: { from: string; name: string; text: string; at: number }): void;
  select(id: string | null): void;
  setCam(c: DerbyCam): void;
  /** Server time in ms. */
  now(): number;
}

export const useDerby = create<DerbyStore>((set, get) => ({
  state: null,
  offset: 0,
  selected: null,
  cam: 'auto',
  focus: false,
  setFocus: (focus) => set({ focus }),
  chat: [],
  pushChat: (m) => set({ chat: [...get().chat, m].slice(-60) }),
  receive: (s) => {
    const prev = get().state;
    set({ state: s, offset: s.serverNow - Date.now(), selected: prev && prev.raceId !== s.raceId ? null : get().selected });
  },
  select: (id) => set({ selected: id }),
  setCam: (cam) => set({ cam }),
  now: () => Date.now() + get().offset,
}));
