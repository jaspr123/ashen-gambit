// AiPlayer — Stockfish 17.1 (single-threaded WASM, runs in a Web Worker) with
// five difficulty levels. Falls back to the shared alpha-beta AI if the
// worker cannot start. War Chess restrictions are respected by validating the
// engine's choice against the restricted legal-move list.

import { AI_LEVELS, chooseMove, type AiLevelId } from '@ashen/shared';
import type { Move } from 'chess.js';
import { withBase } from '../core/base';

export interface AiMove { from: string; to: string; promotion?: string }

class AiPlayerImpl {
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private pending: ((line: string) => void) | null = null;
  failed = false;

  private start(): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve) => {
      try {
        const w = new Worker(withBase('/engine/stockfish.js'));
        this.worker = w;
        const timer = setTimeout(() => { this.failed = true; resolve(false); }, 8000);
        w.onmessage = (e: MessageEvent) => {
          const line = String(e.data);
          if (line === 'uciok') { w.postMessage('isready'); }
          else if (line === 'readyok') { clearTimeout(timer); resolve(true); }
          this.pending?.(line);
        };
        w.onerror = () => { clearTimeout(timer); this.failed = true; resolve(false); };
        w.postMessage('uci');
      } catch {
        this.failed = true;
        resolve(false);
      }
    });
    return this.ready;
  }

  async bestMove(fen: string, level: AiLevelId, legal?: Move[]): Promise<AiMove | null> {
    const cfg = AI_LEVELS.find((l) => l.id === level) ?? AI_LEVELS[1];
    const fallback = () => chooseMove(fen, { depth: Math.min(3, cfg.depth), timeMs: 400, blunderChance: cfg.blunderChance, legal });
    if (legal && legal.length && Math.random() < cfg.blunderChance) {
      const m = legal[Math.floor(Math.random() * legal.length)];
      return { from: m.from, to: m.to, promotion: m.promotion };
    }
    const ok = await this.start();
    if (!ok || !this.worker) return fallback();
    const w = this.worker;
    const uci = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => { this.pending = null; resolve(null); }, cfg.moveTimeMs + 4000);
      this.pending = (line) => {
        if (line.startsWith('bestmove')) { clearTimeout(timer); this.pending = null; resolve(line.split(' ')[1] ?? null); }
      };
      w.postMessage(`setoption name Skill Level value ${cfg.skill}`);
      w.postMessage(`position fen ${fen}`);
      w.postMessage(`go depth ${cfg.depth} movetime ${cfg.moveTimeMs}`);
    });
    if (!uci || uci === '(none)') return fallback();
    const mv: AiMove = { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
    if (legal && !legal.some((m) => m.from === mv.from && m.to === mv.to)) return fallback();
    return mv;
  }

  stop() { this.worker?.postMessage('stop'); }
}

export const AiPlayer = new AiPlayerImpl();
