import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocateBalanced, drawBalanced, seededRng } from './draw.js';

interface It {
  id: number;
  value: string;
  perspective: string;
}

const itemsArb = fc
  .array(
    fc.record({
      value: fc.constantFrom('a', 'b', 'c', 'd'),
      perspective: fc.constantFrom('S', 'T', 'F'),
    }),
    { minLength: 0, maxLength: 80 },
  )
  .map((xs) => xs.map((x, id) => ({ id, ...x }) as It));

const counts = (xs: It[], key: (i: It) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
};

describe('Ausgewogene Ziehung (8.1, 8.18)', () => {
  it('Property: Umfang, Duplikatfreiheit und Herkunft', () => {
    fc.assert(
      fc.property(itemsArb, fc.integer({ min: 0, max: 100 }), fc.integer(), (items, k, seed) => {
        const drawn = drawBalanced(
          items,
          k,
          [(i) => i.value, (i) => i.perspective],
          seededRng(seed),
        );
        expect(drawn).toHaveLength(Math.min(k, items.length));
        expect(new Set(drawn.map((d) => d.id)).size).toBe(drawn.length);
        for (const d of drawn) expect(items).toContain(d);
      }),
      { numRuns: 300 },
    );
  });

  it('Property: Werte unterscheiden sich um höchstens 1, außer ein Wert ist ausgeschöpft', () => {
    fc.assert(
      fc.property(itemsArb, fc.integer({ min: 0, max: 100 }), fc.integer(), (items, k, seed) => {
        const drawn = drawBalanced(
          items,
          k,
          [(i) => i.value, (i) => i.perspective],
          seededRng(seed),
        );
        const avail = counts(items, (i) => i.value);
        const got = counts(drawn, (i) => i.value);
        const notExhausted = [...avail.keys()].filter((v) => (got.get(v) ?? 0) < avail.get(v)!);
        // Jeder nicht ausgeschöpfte Wert hat mindestens so viele wie jeder andere minus 1
        for (const v of notExhausted) {
          for (const w of avail.keys()) {
            expect(got.get(v) ?? 0).toBeGreaterThanOrEqual((got.get(w) ?? 0) - 1);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('verteilt 30 Plätze auf 4 Werte mit je 60 Fragen als 8/8/7/7 und Perspektiven gleichmäßig', () => {
    const items: It[] = [];
    for (const value of ['a', 'b', 'c', 'd'])
      for (let i = 0; i < 60; i++)
        items.push({ id: items.length, value, perspective: 'STF'[i % 3]! });
    for (let seed = 1; seed <= 20; seed++) {
      const drawn = drawBalanced(
        items,
        30,
        [(i) => i.value, (i) => i.perspective],
        seededRng(seed),
      );
      expect([...counts(drawn, (i) => i.value).values()].sort()).toEqual([7, 7, 8, 8]);
      const persp = [...counts(drawn, (i) => i.perspective).values()];
      expect(Math.max(...persp) - Math.min(...persp)).toBeLessThanOrEqual(1);
    }
  });

  it('gibt Plätze eines zu kleinen Werts an die übrigen weiter', () => {
    expect(allocateBalanced(10, [2, 20, 20], seededRng(1))).toEqual([2, 4, 4]);
    expect(allocateBalanced(100, [2, 3], seededRng(1))).toEqual([2, 3]);
    expect(allocateBalanced(0, [5, 5], seededRng(1))).toEqual([0, 0]);
  });
});
