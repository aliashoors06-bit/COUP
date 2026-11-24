export interface Rng {
  /** Uniform integer in [0, n) */
  int(n: number): number;
}

/**
 * Cryptographically secure RNG backed by the Web Crypto API
 * (available in Node >= 19 and every modern browser).
 */
export const secureRng: Rng = {
  int(n: number): number {
    if (n <= 0) return 0;
    const buf = new Uint32Array(1);
    // Rejection sampling avoids modulo bias.
    const limit = Math.floor(0x100000000 / n) * n;
    let x: number;
    do {
      globalThis.crypto.getRandomValues(buf);
      x = buf[0]!;
    } while (x >= limit);
    return x % n;
  },
};

/** Deterministic seeded RNG (mulberry32) — used by tests and bots. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    int(n: number) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * n);
    },
  };
}

/** Fisher–Yates shuffle (in place). */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}
