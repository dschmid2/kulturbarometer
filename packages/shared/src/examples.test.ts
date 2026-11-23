import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { drawSubset, seededRng } from './draw.js';
import { applyAnonymityThreshold } from './evaluation.js';
import { round2 } from './math.js';
import {
  anonymityThresholdSchema,
  campaignInputSchema,
  externalItemSchema,
  itemInputSchema,
  valueInputSchema,
} from './schemas.js';
import { computeCampaignResult, type SnapshotItemInput } from './scoring.js';
import { isAllowedCampaignTransition } from './domain.js';

const V1 = '00000000-0000-4000-8000-000000000001';
const V2 = '00000000-0000-4000-8000-000000000002';

describe('Validierung', () => {
  it('lehnt leere oder nur aus Leerzeichen bestehende Namen ab (2.2)', () => {
    expect(valueInputSchema.safeParse({ name: '   ', description: '' }).success).toBe(false);
    expect(valueInputSchema.safeParse({ name: 'Vertrauen', description: '' }).success).toBe(true);
  });

  it('verlangt mindestens eine Zuordnung > 0 % (5.8) und Gewichtungen 0–100 % (5.7)', () => {
    const base = { text: 'Ich halte Termine ein', itemType: 'FRAGE', perspective: 'SELBST' };
    expect(
      itemInputSchema.safeParse({ ...base, assignments: [{ valueId: V1, weight: 0 }] }).success,
    ).toBe(false);
    expect(
      itemInputSchema.safeParse({ ...base, assignments: [{ valueId: V1, weight: 101 }] }).success,
    ).toBe(false);
    expect(
      itemInputSchema.safeParse({
        ...base,
        assignments: [
          { valueId: V1, weight: 100 },
          { valueId: V2, weight: 100 },
        ],
      }).success,
    ).toBe(true);
  });

  it('lehnt fehlende Perspektive ab (5.4)', () => {
    const r = itemInputSchema.safeParse({
      text: 'x',
      itemType: 'FRAGE',
      assignments: [{ valueId: V1, weight: 50 }],
    });
    expect(r.success).toBe(false);
  });

  it('Import-Items sind strikt: unbekannte Schlüssel werden abgelehnt', () => {
    const item = {
      text: 'In meinem Team werden Termine eingehalten',
      itemType: 'SITUATION',
      perspective: 'TEAM',
      assignments: [{ valueName: 'Vertrauen', weight: 80 }],
    };
    expect(externalItemSchema.safeParse(item).success).toBe(true);
    expect(externalItemSchema.safeParse({ ...item, __proto__: { x: 1 }, extra: 1 }).success).toBe(
      false,
    );
  });

  it('verlangt Enddatum nach Startdatum (6.3)', () => {
    expect(
      campaignInputSchema.safeParse({
        title: 'Herbst',
        startDate: '2026-12-01',
        endDate: '2026-12-01',
      }).success,
    ).toBe(false);
    expect(
      campaignInputSchema.safeParse({
        title: 'Herbst',
        startDate: '2026-12-01',
        endDate: '2026-12-15',
      }).success,
    ).toBe(true);
  });

  it('Anonymitätsschwelle nur ganzzahlig von 3 bis 100 (6.29)', () => {
    expect(anonymityThresholdSchema.safeParse(2).success).toBe(false);
    expect(anonymityThresholdSchema.safeParse(3).success).toBe(true);
    expect(anonymityThresholdSchema.safeParse(5.5).success).toBe(false);
    expect(anonymityThresholdSchema.safeParse(101).success).toBe(false);
  });

  it('Feature: kulturbarometer, Property 17: nur Entwurf → Aktiv → Abgeschlossen', () => {
    expect(isAllowedCampaignTransition('ENTWURF', 'AKTIV')).toBe(true);
    expect(isAllowedCampaignTransition('AKTIV', 'ABGESCHLOSSEN')).toBe(true);
    expect(isAllowedCampaignTransition('ENTWURF', 'ABGESCHLOSSEN')).toBe(false);
    expect(isAllowedCampaignTransition('ABGESCHLOSSEN', 'AKTIV')).toBe(false);
    expect(isAllowedCampaignTransition('AKTIV', 'ENTWURF')).toBe(false);
  });
});

describe('Ziehung der Teilnehmer-Teilmenge', () => {
  it('Feature: kulturbarometer, Property 9 und 10: Größe min(n, aktiv), nur aktive Items, ohne Duplikate', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer(),
        (active, n, seed) => {
          const drawn = drawSubset(active, n, seededRng(seed));
          expect(drawn.length).toBe(Math.min(n, active.length));
          expect(new Set(drawn).size).toBe(drawn.length);
          for (const d of drawn) expect(active).toContain(d);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('ist mit gleichem Seed reproduzierbar', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(drawSubset(ids, 3, seededRng(42))).toEqual(drawSubset(ids, 3, seededRng(42)));
  });
});

describe('Rundung', () => {
  it.each([
    [1.005, 1.01],
    [2.675, 2.68],
    [-0.125, -0.13],
    [3.333333, 3.33],
  ])('round2(%s) = %s', (x, y) => expect(round2(x)).toBe(y));
});

describe('Auswertung mit Schwelle (Beispiele)', () => {
  const items: SnapshotItemInput[] = [
    {
      id: 's1',
      perspective: 'SELBST',
      deactivatedAt: null,
      assignments: [{ valueId: 'v', weight: 100 }],
    },
    {
      id: 't1',
      perspective: 'TEAM',
      deactivatedAt: null,
      assignments: [{ valueId: 'v', weight: 50 }],
    },
  ];
  const participations = (n: number, teamFor: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      submissionSeq: i + 1,
      ratings: [
        { snapshotItemId: 's1', rating: 4, comment: 'gut' },
        ...(i < teamFor ? [{ snapshotItemId: 't1', rating: 2 }] : []),
      ],
    }));
  const evaluate = (status: 'AKTIV' | 'ABGESCHLOSSEN', n: number, teamFor: number, t = 5) =>
    applyAnonymityThreshold(
      status,
      t,
      computeCampaignResult({
        status,
        threshold: t,
        values: [{ id: 'v', name: 'Vertrauen' }],
        snapshotItems: items,
        participations: participations(n, teamFor),
      }),
    );

  it('zeigt unter der Schwelle nur die Anzahl (10.6)', () => {
    expect(evaluate('ABGESCHLOSSEN', 4, 4)).toEqual({
      state: 'UNTER_SCHWELLE',
      provisional: false,
      totalParticipations: 4,
      threshold: 5,
    });
  });

  it('unterdrückt Perspektiven mit zu wenigen Beitragenden samt Differenzen (10.13)', () => {
    const ev = evaluate('ABGESCHLOSSEN', 6, 2);
    if (ev.state !== 'OK') throw new Error('erwartet OK');
    const v = ev.values[0]!;
    expect(v.perspectives.SELBST).toMatchObject({ shown: true, istScore: 4, contributors: 6 });
    expect(v.perspectives.TEAM).toEqual({ shown: false, reason: 'ZU_WENIGE_ANTWORTEN' });
    expect(v.perspectives.FUEHRUNG).toEqual({ shown: false, reason: 'KEINE_DATEN' });
    expect(v.gaps).toEqual({ selbstTeam: null, selbstFuehrung: null, teamFuehrung: null });
    expect(v.comments).toEqual({ shown: true, items: Array(6).fill('gut') });
  });

  it('Zwischenauswertung bezieht nur volle Stufen ein (10.12)', () => {
    const ev = evaluate('AKTIV', 9, 9);
    if (ev.state !== 'OK') throw new Error('erwartet OK');
    expect(ev.provisional).toBe(true);
    expect(ev.includedParticipations).toBe(5);
    expect(ev.totalParticipations).toBe(9);
  });

  it('null Antworten ergeben nur den Hinweis (10.8)', () => {
    expect(evaluate('ABGESCHLOSSEN', 0, 0)).toEqual({
      state: 'KEINE_ANTWORTEN',
      provisional: false,
    });
  });
});
