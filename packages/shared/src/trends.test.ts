import { describe, expect, it } from 'vitest';
import { buildValueTrends, type CampaignEvaluation, type PerspectiveCell } from './evaluation.js';

const shown = (istScore: number, stdDev = 0.5): PerspectiveCell => ({
  shown: true,
  istScore,
  ratingCount: 10,
  contributors: 5,
  distribution: {
    classCounts: [0, 0, 5, 0, 0],
    classShares: [0, 0, 100, 0, 0],
    histogram: [0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    median: istScore,
    stdDev,
  },
});
const hidden: PerspectiveCell = { shown: false, reason: 'ZU_WENIGE_ANTWORTEN' };

const ok = (
  cells: [PerspectiveCell, PerspectiveCell, PerspectiveCell],
  name = 'Ehrlich',
): CampaignEvaluation => ({
  state: 'OK',
  provisional: false,
  totalParticipations: 5,
  includedParticipations: 5,
  threshold: 5,
  noData: false,
  deactivatedItems: [],
  values: [
    {
      valueId: 'v1',
      name,
      perspectives: { SELBST: cells[0], TEAM: cells[1], FUEHRUNG: cells[2] },
      gaps: { selbstTeam: null, selbstFuehrung: null, teamFuehrung: null },
      comments: { shown: true, items: [] },
    },
  ],
});

describe('Entwicklung über Kampagnen (10.4, 10.5, 10.15, 10.20)', () => {
  it('ordnet chronologisch, kennzeichnet Richtung und überspringt Lücken', () => {
    const r = buildValueTrends([
      {
        id: 'c3',
        title: 'C',
        endDate: '2026-09-30',
        evaluation: ok([shown(3.5), shown(3), shown(4.1, 0.9)]),
      },
      {
        id: 'c1',
        title: 'A',
        endDate: '2026-01-31',
        evaluation: ok([shown(3.2), shown(3), shown(3)]),
      },
      {
        id: 'c2',
        title: 'B',
        endDate: '2026-05-31',
        evaluation: ok([shown(3.2), hidden, shown(3.4)]),
      },
    ]);
    expect(r.campaigns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    const pts = r.values[0]!.points;
    expect(pts[0]!.SELBST!.direction).toBeNull();
    expect(pts[1]!.SELBST!.direction).toBe('GLEICH');
    expect(pts[1]!.TEAM).toBeNull();
    expect(pts[2]!.SELBST!.direction).toBe('STEIGT');
    // Team: Vergleich mit c1, weil c2 eine Lücke ist
    expect(pts[2]!.TEAM!.direction).toBe('GLEICH');
    expect(pts[2]!.FUEHRUNG).toEqual({ istScore: 4.1, stdDev: 0.9, direction: 'STEIGT' });
  });

  it('ignoriert Kampagnen unter der Schwelle und verwendet den aktuellen Namen', () => {
    const r = buildValueTrends(
      [
        {
          id: 'c1',
          title: 'A',
          endDate: '2026-01-31',
          evaluation: ok([shown(4), shown(3), shown(2)], 'Alt'),
        },
        {
          id: 'c2',
          title: 'B',
          endDate: '2026-02-28',
          evaluation: {
            state: 'UNTER_SCHWELLE',
            provisional: false,
            totalParticipations: 2,
            threshold: 5,
          },
        },
      ],
      new Map([['v1', 'Neu']]),
    );
    expect(r.values[0]!.name).toBe('Neu');
    expect(r.values[0]!.points[1]).toEqual({ SELBST: null, TEAM: null, FUEHRUNG: null });
  });
});
