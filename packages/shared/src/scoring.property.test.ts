import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PERSPECTIVES, type Perspective } from './domain.js';
import { round2 } from './math.js';
import {
  computeCampaignResult,
  computeDistribution,
  computeIstScore,
  computeIstScoreRaw,
  computePerspectiveGaps,
  distributionClassOf,
  selectIncludedParticipations,
  type ParticipationInput,
  type SnapshotItemInput,
} from './scoring.js';
import { applyAnonymityThreshold } from './evaluation.js';

const RUNS = { numRuns: 200 };
const EPS = 1e-9;

// Bewertungen stufenlos mit zwei Nachkommastellen, Gewichtungen 0–100 %
const ratingArb = fc.integer({ min: 100, max: 500 }).map((x) => x / 100);
const weightArb = fc.integer({ min: 0, max: 100 });
const positiveWeightArb = fc.integer({ min: 1, max: 100 });
const contributionArb = fc.record({ weight: weightArb, rating: ratingArb });
const contributionsWithPositive = fc
  .tuple(fc.record({ weight: positiveWeightArb, rating: ratingArb }), fc.array(contributionArb))
  .map(([first, rest]) => [first, ...rest]);

describe('Ist-Score (Anforderung 9)', () => {
  it('Feature: wertebarometer, Property 1: Ist-Score liegt im gültigen Wertebereich', () => {
    fc.assert(
      fc.property(contributionsWithPositive, (cs) => {
        const s = computeIstScore(cs)!;
        expect(s).toBeGreaterThanOrEqual(1);
        expect(s).toBeLessThanOrEqual(5);
      }),
      RUNS,
    );
  });

  it('Feature: wertebarometer, Property 2: Konstante Bewertungen ergeben genau diese Bewertung', () => {
    fc.assert(
      fc.property(ratingArb, fc.array(positiveWeightArb, { minLength: 1 }), (r, ws) => {
        expect(computeIstScore(ws.map((weight) => ({ weight, rating: r })))).toBe(r);
      }),
      RUNS,
    );
  });

  it('Feature: wertebarometer, Property 3: Homogenität der Gewichtungen', () => {
    fc.assert(
      fc.property(contributionsWithPositive, fc.integer({ min: 1, max: 1000 }), (cs, k) => {
        const scaled = cs.map((c) => ({ ...c, weight: c.weight * k }));
        expect(computeIstScoreRaw(scaled)!).toBeCloseTo(computeIstScoreRaw(cs)!, 9);
      }),
      RUNS,
    );
  });

  it('Feature: wertebarometer, Property 4: Zuordnungen mit Gewichtung 0 sind neutral', () => {
    fc.assert(
      fc.property(contributionsWithPositive, ratingArb, (cs, r) => {
        expect(computeIstScore([...cs, { weight: 0, rating: r }])).toBe(computeIstScore(cs));
      }),
      RUNS,
    );
  });

  it('Feature: wertebarometer, Property 5: Rundung auf zwei Nachkommastellen ist idempotent', () => {
    fc.assert(
      fc.property(fc.double({ min: -10, max: 10, noNaN: true }), (x) => {
        expect(round2(round2(x))).toBe(round2(x));
      }),
      RUNS,
    );
  });

  it('Feature: wertebarometer, Property 6: "keine Daten" genau bei fehlender beitragender Zuordnung', () => {
    fc.assert(
      fc.property(fc.array(contributionArb), (cs) => {
        const hasPositive = cs.some((c) => c.weight > 0);
        expect(computeIstScore(cs) === null).toBe(!hasPositive);
      }),
      RUNS,
    );
  });

  it('Feature: wertebarometer, Property 8: Monotone Schranken beim Hinzufügen einer Bewertung', () => {
    fc.assert(
      fc.property(contributionsWithPositive, positiveWeightArb, ratingArb, (cs, w, r) => {
        const before = computeIstScoreRaw(cs)!;
        const after = computeIstScoreRaw([...cs, { weight: w, rating: r }])!;
        expect(after).toBeGreaterThanOrEqual(Math.min(before, r) - EPS);
        expect(after).toBeLessThanOrEqual(Math.max(before, r) + EPS);
        const ratings = [...cs.filter((c) => c.weight > 0).map((c) => c.rating), r];
        expect(after).toBeGreaterThanOrEqual(Math.min(...ratings) - EPS);
        expect(after).toBeLessThanOrEqual(Math.max(...ratings) + EPS);
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Generator für ganze Kampagnen: Werte, Snapshot-Items, Antworten
// ---------------------------------------------------------------------------

const VALUE_IDS = ['v1', 'v2', 'v3'];
const VALUES = VALUE_IDS.map((id) => ({ id, name: `Wert ${id}` }));

const snapshotItemArb = (id: string) =>
  fc.record({
    id: fc.constant(id),
    perspective: fc.constantFrom<Perspective>(...PERSPECTIVES),
    deactivatedAt: fc.option(fc.constant('2026-11-20T10:00:00.000Z'), { freq: 4 }),
    text: fc.constant(`Item ${id}`),
    assignments: fc
      .uniqueArray(fc.constantFrom(...VALUE_IDS), { minLength: 1, maxLength: 3 })
      .chain((ids) =>
        fc.tuple(
          ...ids.map((valueId) => fc.record({ valueId: fc.constant(valueId), weight: weightArb })),
        ),
      ),
  }) as fc.Arbitrary<SnapshotItemInput>;

const campaignArb = fc
  .integer({ min: 1, max: 8 })
  .chain((itemCount) =>
    fc.tuple(...Array.from({ length: itemCount }, (_, i) => snapshotItemArb(`i${i}`))),
  )
  .chain((items) =>
    fc.tuple(
      fc.constant(items),
      fc.array(
        fc
          .subarray(
            items.map((i) => i.id),
            { minLength: 1 },
          )
          .chain((seen) =>
            fc.tuple(
              ...seen.map((id) =>
                fc.record({
                  snapshotItemId: fc.constant(id),
                  rating: ratingArb,
                  comment: fc.option(fc.constant('Kommentar')),
                }),
              ),
            ),
          ),
        { maxLength: 25 },
      ),
    ),
  )
  .map(([items, ratingSets]) => ({
    items,
    participations: ratingSets.map((ratings, idx): ParticipationInput => ({
      id: `p${idx}`,
      submissionSeq: idx + 1,
      ratings,
    })),
  }));

describe('Kampagnenergebnis (Anforderung 9 und 10)', () => {
  it('Feature: wertebarometer, Property 7: Perspektiven sind unabhängig', () => {
    fc.assert(
      fc.property(campaignArb, ratingArb, ({ items, participations }, newRating) => {
        const base = computeCampaignResult({
          status: 'ABGESCHLOSSEN',
          threshold: 3,
          values: VALUES,
          snapshotItems: items,
          participations,
        });
        // Alle Bewertungen von Items der Perspektive TEAM ändern
        const teamIds = new Set(items.filter((i) => i.perspective === 'TEAM').map((i) => i.id));
        const changed = participations.map((p) => ({
          ...p,
          ratings: p.ratings.map((r) =>
            teamIds.has(r.snapshotItemId) ? { ...r, rating: newRating } : r,
          ),
        }));
        const after = computeCampaignResult({
          status: 'ABGESCHLOSSEN',
          threshold: 3,
          values: VALUES,
          snapshotItems: items,
          participations: changed,
        });
        for (let v = 0; v < VALUES.length; v++) {
          for (const p of ['SELBST', 'FUEHRUNG'] as const) {
            expect(after.values[v]!.perspectives[p].istScoreRaw).toBe(
              base.values[v]!.perspectives[p].istScoreRaw,
            );
          }
        }
      }),
      RUNS,
    );
  });

  it('Feature: wertebarometer, Property 21: Score schließt alle Bewertungen deaktivierter Items aus', () => {
    fc.assert(
      fc.property(campaignArb, ({ items, participations }) => {
        const withAll = computeCampaignResult({
          status: 'ABGESCHLOSSEN',
          threshold: 3,
          values: VALUES,
          snapshotItems: items,
          participations,
        });
        const deactivated = new Set(items.filter((i) => i.deactivatedAt !== null).map((i) => i.id));
        const stripped = participations.map((p) => ({
          ...p,
          ratings: p.ratings.filter((r) => !deactivated.has(r.snapshotItemId)),
        }));
        const withoutDeactivated = computeCampaignResult({
          status: 'ABGESCHLOSSEN',
          threshold: 3,
          values: VALUES,
          snapshotItems: items,
          participations: stripped,
        });
        for (let v = 0; v < VALUES.length; v++) {
          for (const p of PERSPECTIVES) {
            const a = withAll.values[v]!.perspectives[p];
            const b = withoutDeactivated.values[v]!.perspectives[p];
            expect(a.istScoreRaw).toBe(b.istScoreRaw);
            expect(a.ratingCount).toBe(b.ratingCount);
          }
        }
        for (const d of withAll.deactivatedItems) {
          const stored = participations
            .flatMap((p) => p.ratings)
            .filter((r) => r.snapshotItemId === d.snapshotItemId).length;
          expect(d.excludedRatings).toBe(stored);
        }
      }),
      RUNS,
    );
  });

  it('Feature: wertebarometer, Property 27: Anonymitätsschwelle unterdrückt alle Ergebnisse darunter', () => {
    fc.assert(
      fc.property(campaignArb, fc.integer({ min: 3, max: 10 }), ({ items, participations }, t) => {
        const result = computeCampaignResult({
          status: 'ABGESCHLOSSEN',
          threshold: t,
          values: VALUES,
          snapshotItems: items,
          participations,
        });
        const ev = applyAnonymityThreshold('ABGESCHLOSSEN', t, result);
        if (participations.length === 0) {
          expect(ev.state).toBe('KEINE_ANTWORTEN');
          return;
        }
        if (participations.length < t) {
          expect(ev.state).toBe('UNTER_SCHWELLE');
          expect(JSON.stringify(ev)).not.toContain('istScore');
          expect(JSON.stringify(ev)).not.toContain('Kommentar');
          return;
        }
        expect(ev.state).toBe('OK');
        if (ev.state !== 'OK') return;
        for (const v of ev.values) {
          const raw = result.values.find((r) => r.valueId === v.valueId)!;
          for (const p of PERSPECTIVES) {
            const shouldShow =
              raw.perspectives[p].istScore !== null && raw.perspectives[p].contributors >= t;
            expect(v.perspectives[p].shown).toBe(shouldShow);
          }
          expect(v.comments.shown).toBe(raw.contributorsAny >= t);
        }
      }),
      RUNS,
    );
  });

  it('Feature: wertebarometer, Property 28: Zwischenauswertung ändert sich nur in Stufen der Schwelle', () => {
    fc.assert(
      fc.property(campaignArb, fc.integer({ min: 3, max: 6 }), ({ items, participations }, t) => {
        const n = participations.length;
        const included = selectIncludedParticipations(participations, 'AKTIV', t);
        expect(included.length).toBe(Math.floor(n / t) * t);
        expect(included.map((p) => p.submissionSeq)).toEqual(
          Array.from({ length: included.length }, (_, i) => i + 1),
        );
        // Innerhalb einer Stufe identisches Ergebnis
        const stepEnd = Math.floor(n / t) * t;
        if (n > stepEnd) {
          const a = computeCampaignResult({
            status: 'AKTIV',
            threshold: t,
            values: VALUES,
            snapshotItems: items,
            participations: participations.slice(0, stepEnd),
          });
          const b = computeCampaignResult({
            status: 'AKTIV',
            threshold: t,
            values: VALUES,
            snapshotItems: items,
            participations,
          });
          expect(b.values).toEqual(a.values);
        }
      }),
      RUNS,
    );
  });
});

describe('Verteilung und Perspektivdifferenzen (9.8–9.10)', () => {
  it('Feature: wertebarometer, Property 31: Verteilung ist konsistent mit den beitragenden Teilnehmern', () => {
    fc.assert(
      fc.property(fc.array(ratingArb, { minLength: 1, maxLength: 50 }), (scores) => {
        const d = computeDistribution(scores)!;
        expect(d.classCounts.reduce((a, b) => a + b, 0)).toBe(scores.length);
        expect(d.median).toBeGreaterThanOrEqual(round2(Math.min(...scores)));
        expect(d.median).toBeLessThanOrEqual(round2(Math.max(...scores)));
        expect(d.stdDev).toBeGreaterThanOrEqual(0);
        const allEqual = scores.every((s) => s === scores[0]);
        if (allEqual) expect(d.stdDev).toBe(0);
        else expect(d.stdDev).toBeGreaterThan(0);
      }),
      RUNS,
    );
  });

  it('Feature: wertebarometer, Property 32: Perspektivdifferenzen sind antisymmetrisch und konsistent', () => {
    const scoreOrNull = fc.option(fc.double({ min: 1, max: 5, noNaN: true }), { freq: 4 });
    fc.assert(
      fc.property(scoreOrNull, scoreOrNull, scoreOrNull, (s, t, f) => {
        const gaps = computePerspectiveGaps({ SELBST: s, TEAM: t, FUEHRUNG: f });
        expect(gaps.selbstTeam === null).toBe(s === null || t === null);
        expect(gaps.selbstFuehrung === null).toBe(s === null || f === null);
        expect(gaps.teamFuehrung === null).toBe(t === null || f === null);
        if (s !== null && t !== null) expect(gaps.selbstTeam).toBe(round2(s - t));
        if (s !== null && t !== null && f !== null) {
          expect(
            Math.abs(gaps.selbstFuehrung! - (gaps.selbstTeam! + gaps.teamFuehrung!)),
          ).toBeLessThanOrEqual(0.02 + EPS);
        }
      }),
      RUNS,
    );
  });
});

describe('Verteilungsklassen (Beispiele)', () => {
  it.each([
    [1.0, 0],
    [1.79, 0],
    [1.8, 1],
    [1.7999999999, 1],
    [2.6, 2],
    [3.39, 2],
    [3.4, 3],
    [4.19, 3],
    [4.2, 4],
    [5.0, 4],
  ])('Score %s liegt in Klasse %i', (score, cls) => {
    expect(distributionClassOf(score)).toBe(cls);
  });

  it('erkennt Polarisierung an der Standardabweichung', () => {
    const d = computeDistribution([1, 1, 1, 5, 5, 5])!;
    expect(d.classCounts).toEqual([3, 0, 0, 0, 3]);
    expect(d.median).toBe(3);
    expect(d.stdDev).toBe(2);
  });
});
