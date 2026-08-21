/* Deterministic PRNG (mulberry32) so generated floors are reproducible. */

export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) {
    this.seed = typeof seed === 'number' ? seed : hashSeed(String(seed));
    this.rand = mulberry32(this.seed);
  }
  next() { return this.rand(); }
  int(lo, hi) {
    const n = Math.floor(this.rand() * (hi - lo + 1)) + lo;
    return Math.max(lo, Math.min(hi, n));
  }
  pick(arr) {
    if (!arr.length) return undefined;
    return arr[Math.floor(this.rand() * arr.length)];
  }
  chance(p) { return this.rand() < p; }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  roll(dice, sides) {
    let s = 0;
    for (let i = 0; i < dice; i++) s += this.int(1, sides);
    return s;
  }
  d(sides) { return this.int(1, sides); }
}

export function randomSeedString() {
  return Math.random().toString(36).slice(2, 8);
}
