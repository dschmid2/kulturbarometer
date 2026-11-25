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

/**
 * Verteilt `k` Plätze möglichst gleichmäßig auf Gruppen mit begrenzter Größe (`caps`):
 * Jede Gruppe erhält gleich viele Plätze; ein Rest geht an zufällig gewählte Gruppen, und
 * Plätze, die eine zu kleine Gruppe nicht füllen kann, gehen an die übrigen. Ergebnis: Die
 * Anzahlen unterscheiden sich um höchstens 1, außer eine Gruppe ist ausgeschöpft.
 */
export function allocateBalanced(
  k: number,
  caps: readonly number[],
  rng: Rng = Math.random,
  /** Optional: bisherige Anzahl je Gruppe; ein Rest geht bevorzugt an Gruppen mit wenig. */
  usedSoFar?: readonly number[],
): number[] {
  const alloc = caps.map(() => 0);
  let remaining = Math.min(
    Math.max(0, k),
    caps.reduce((a, b) => a + b, 0),
  );
  let open = caps.map((_, i) => i).filter((i) => caps[i]! > 0);
  while (remaining > 0 && open.length > 0) {
    const share = Math.floor(remaining / open.length);
    if (share === 0) {
      // Zufällige Reihenfolge, danach stabil nach bisheriger Anzahl sortiert
      const order = drawSubset(open, open.length, rng);
      if (usedSoFar) order.sort((a, b) => usedSoFar[a]! + alloc[a]! - (usedSoFar[b]! + alloc[b]!));
      for (const i of order.slice(0, remaining)) alloc[i]!++;
      break;
    }
    for (const i of open) {
      const add = Math.min(share, caps[i]! - alloc[i]!);
      alloc[i]! += add;
      remaining -= add;
    }
    open = open.filter((i) => alloc[i]! < caps[i]!);
  }
  return alloc;
}

/**
 * Ausgewogene Ziehung (Anforderung 8.1, 8.18): Die Elemente werden nach dem ersten Schlüssel
 * gruppiert (z. B. Hauptwert), die Plätze gleichmäßig auf die Gruppen verteilt und innerhalb
 * jeder Gruppe rekursiv nach den weiteren Schlüsseln (z. B. Perspektive) gezogen. Die
 * Reihenfolge des Ergebnisses wird zufällig gemischt.
 */
export function drawBalanced<T>(
  items: readonly T[],
  k: number,
  keys: ReadonlyArray<(item: T) => string>,
  rng: Rng = Math.random,
): T[] {
  // Bisher vergebene Plätze je Schlüssel und Ebene, damit sich Reste über Gruppen ausgleichen
  const tally = keys.map(() => new Map<string, number>());
  const pick = (list: readonly T[], n: number, depth: number): T[] => {
    if (depth >= keys.length) return drawSubset(list, n, rng);
    const groups = new Map<string, T[]>();
    for (const item of list) {
      const key = keys[depth]!(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    // Feste Gruppenreihenfolge, damit nur der Zufallsgenerator das Ergebnis bestimmt
    const ordered = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const alloc = allocateBalanced(
      n,
      ordered.map(([, g]) => g.length),
      rng,
      ordered.map(([key]) => tally[depth]!.get(key) ?? 0),
    );
    ordered.forEach(([key], i) =>
      tally[depth]!.set(key, (tally[depth]!.get(key) ?? 0) + alloc[i]!),
    );
    return ordered.flatMap(([, g], i) => pick(g, alloc[i]!, depth + 1));
  };
  const chosen = pick(items, Math.min(k, items.length), 0);
  return drawSubset(chosen, chosen.length, rng);
}
