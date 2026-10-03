/** Token bucket. `take()` returns false when the caller is over its rate. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private capacity: number, private refillPerSec: number) { this.tokens = capacity; }
  take(n = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

export function bucketsFor() {
  return {
    general: new TokenBucket(40, 20),
    game: new TokenBucket(8, 4),
    chat: new TokenBucket(4, 0.6),
  };
}
