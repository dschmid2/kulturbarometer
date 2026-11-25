/**
 * Anzeigemodell der Auswertung mit Anonymitätsschwelle (Anforderung 10.6, 10.13, 10.14).
 * Nur dieses Modell verlässt den Server; unterdrückte Werte sind darin nicht enthalten.
 */
import { PERSPECTIVES, type CampaignStatus, type Perspective } from './domain.js';
import type {
  CampaignResult,
  DeactivatedItemResult,
  Distribution,
  PerspectiveGaps,
  ValueComment,
} from './scoring.js';

export type PerspectiveCell =
  | { shown: false; reason: 'ZU_WENIGE_ANTWORTEN' | 'KEINE_DATEN' }
  | {
      shown: true;
      istScore: number;
      ratingCount: number;
      contributors: number;
      distribution: Distribution;
    };

export interface ValueEvaluation {
  valueId: string;
  name: string;
  perspectives: Record<Perspective, PerspectiveCell>;
  gaps: PerspectiveGaps;
  comments:
    { shown: true; items: ValueComment[] } | { shown: false; reason: 'ZU_WENIGE_ANTWORTEN' };
}

export type CampaignEvaluation =
  | { state: 'ENTWURF' }
  | { state: 'KEINE_ANTWORTEN'; provisional: boolean }
  | {
      state: 'UNTER_SCHWELLE';
      provisional: boolean;
      totalParticipations: number;
      threshold: number;
    }
  | {
      state: 'OK';
      provisional: boolean;
      totalParticipations: number;
      includedParticipations: number;
      threshold: number;
      noData: boolean;
      values: ValueEvaluation[];
      deactivatedItems: DeactivatedItemResult[];
    };

export function applyAnonymityThreshold(
  status: CampaignStatus,
  threshold: number,
  result: CampaignResult,
): CampaignEvaluation {
  if (status === 'ENTWURF') return { state: 'ENTWURF' };
  const provisional = status === 'AKTIV';
  const n = result.totalParticipations;
  if (n === 0) return { state: 'KEINE_ANTWORTEN', provisional };
  if (n < threshold || result.includedParticipations < threshold) {
    return { state: 'UNTER_SCHWELLE', provisional, totalParticipations: n, threshold };
  }

  const values: ValueEvaluation[] = result.values.map((v) => {
    const perspectives = {} as Record<Perspective, PerspectiveCell>;
    for (const p of PERSPECTIVES) {
      const r = v.perspectives[p];
      if (r.istScore === null || r.distribution === null) {
        perspectives[p] = { shown: false, reason: 'KEINE_DATEN' };
      } else if (r.contributors < threshold) {
        perspectives[p] = { shown: false, reason: 'ZU_WENIGE_ANTWORTEN' };
      } else {
        perspectives[p] = {
          shown: true,
          istScore: r.istScore,
          ratingCount: r.ratingCount,
          contributors: r.contributors,
          distribution: r.distribution,
        };
      }
    }
    const visible = (p: Perspective) => perspectives[p].shown;
    const gaps: PerspectiveGaps = {
      selbstTeam: visible('SELBST') && visible('TEAM') ? v.gaps.selbstTeam : null,
      selbstFuehrung: visible('SELBST') && visible('FUEHRUNG') ? v.gaps.selbstFuehrung : null,
      teamFuehrung: visible('TEAM') && visible('FUEHRUNG') ? v.gaps.teamFuehrung : null,
    };
    return {
      valueId: v.valueId,
      name: v.name,
      perspectives,
      gaps,
      comments:
        v.contributorsAny >= threshold
          ? { shown: true, items: v.comments }
          : { shown: false, reason: 'ZU_WENIGE_ANTWORTEN' },
    };
  });

  return {
    state: 'OK',
    provisional,
    totalParticipations: n,
    includedParticipations: result.includedParticipations,
    threshold,
    noData: result.noData,
    values: sortValueEvaluations(values),
    deactivatedItems: result.deactivatedItems,
  };
}

/**
 * Sortierung (10.2): aufsteigend nach angezeigtem Ist-Score „Selbst", bei Gleichstand
 * alphabetisch; Werte ohne angezeigten Score „Selbst" alphabetisch am Ende.
 */
export function sortValueEvaluations(values: readonly ValueEvaluation[]): ValueEvaluation[] {
  const score = (v: ValueEvaluation) => {
    const c = v.perspectives.SELBST;
    return c.shown ? c.istScore : null;
  };
  return [...values].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== null && sb !== null && sa !== sb) return sa - sb;
    if (sa === null && sb !== null) return 1;
    if (sa !== null && sb === null) return -1;
    return a.name.localeCompare(b.name, 'de');
  });
}

// ---------------------------------------------------------------------------
// Entwicklung über abgeschlossene Kampagnen (Anforderung 10.4, 10.5, 10.15, 10.20)
// ---------------------------------------------------------------------------

export type TrendDirection = 'STEIGT' | 'FAELLT' | 'GLEICH';

export interface TrendPoint {
  istScore: number;
  stdDev: number;
  /** Richtung gegenüber der letzten vorherigen Kampagne mit angezeigtem Wert; `null` = erste. */
  direction: TrendDirection | null;
}

export interface TrendCampaign {
  id: string;
  title: string;
  endDate: string;
}

export interface ValueTrend {
  valueId: string;
  name: string;
  /** Ein Eintrag je Kampagne (gleiche Reihenfolge wie `campaigns`); `null` = Lücke. */
  points: Array<Record<Perspective, TrendPoint | null>>;
}

export interface TrendResult {
  campaigns: TrendCampaign[];
  values: ValueTrend[];
}

/**
 * Baut den Verlauf je Wert und Perspektive aus den Auswertungen abgeschlossener Kampagnen.
 * Nicht angezeigte Perspektiven (Schwelle nicht erreicht) werden zur Lücke; die Richtung
 * bezieht sich auf die letzte vorherige Kampagne mit angezeigtem Wert (10.15).
 */
export function buildValueTrends(
  input: ReadonlyArray<TrendCampaign & { evaluation: CampaignEvaluation }>,
  currentNames: ReadonlyMap<string, string> = new Map(),
): TrendResult {
  const ordered = [...input].sort((a, b) => a.endDate.localeCompare(b.endDate));
  const names = new Map<string, string>();
  for (const c of ordered) {
    if (c.evaluation.state !== 'OK') continue;
    for (const v of c.evaluation.values) names.set(v.valueId, v.name);
  }
  for (const [id, name] of currentNames) if (names.has(id)) names.set(id, name);

  const values: ValueTrend[] = [...names.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'de'))
    .map(([valueId, name]) => {
      const last: Record<Perspective, number | null> = { SELBST: null, TEAM: null, FUEHRUNG: null };
      const points = ordered.map((c) => {
        const ev =
          c.evaluation.state === 'OK'
            ? c.evaluation.values.find((v) => v.valueId === valueId)
            : undefined;
        const point = {} as Record<Perspective, TrendPoint | null>;
        for (const p of PERSPECTIVES) {
          const cell = ev?.perspectives[p];
          if (!cell || !cell.shown) {
            point[p] = null;
            continue;
          }
          const prev = last[p];
          point[p] = {
            istScore: cell.istScore,
            stdDev: cell.distribution.stdDev,
            direction:
              prev === null
                ? null
                : cell.istScore > prev
                  ? 'STEIGT'
                  : cell.istScore < prev
                    ? 'FAELLT'
                    : 'GLEICH',
          };
          last[p] = cell.istScore;
        }
        return point;
      });
      return { valueId, name, points };
    });

  return {
    campaigns: ordered.map(({ id, title, endDate }) => ({ id, title, endDate })),
    values,
  };
}
