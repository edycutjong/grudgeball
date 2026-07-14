/**
 * Deterministic PRNG + string hashing. Board terrain, gates, and synthetic
 * trails must be byte-identical across runs, so nothing here touches
 * Math.random or Date.
 */

/** FNV-1a 32-bit hash of a string → uint32. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32 — small, solid, deterministic. Returns floats in [0, 1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 4294967296;
  };
}

/** Integer in [0, n). */
export function rngInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}
