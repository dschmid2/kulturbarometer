/**
 * Rundet auf zwei Nachkommastellen, kaufmännisch (bei ,5 vom Nullpunkt weg).
 * Idempotent: round2(round2(x)) === round2(x) (Property 5).
 */
export function round2(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  // Kleiner Ausgleich gegen Binärdarstellungsfehler wie 1.005 → 1.00499999…
  return (sign * Math.round(abs * 100 + 1e-9)) / 100 || 0;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median: leere Menge');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Standardabweichung der Grundgesamtheit (Division durch n). */
export function populationStdDev(values: readonly number[]): number {
  if (values.length === 0) throw new Error('populationStdDev: leere Menge');
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
