/** Ziehung der Teilnehmer-Teilmenge (Anforderung 6.17, 6.19, 8.1). */

export type Rng = () => number;

/**
 * Zieht `min(k, ids.length)` verschiedene Elemente zufällig (partielles Fisher-Yates).
 * Der Zufallsgenerator ist injizierbar, damit Tests deterministisch sind.
 */
export function drawSubset<T>(ids: readonly T[], k: number, rng: Rng = Math.random): T[] {
  const pool = [...ids];
  const size = Math.max(0, Math.min(k, pool.length));
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, size);
}

/** Einfacher deterministischer Generator (mulberry32) für Tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
