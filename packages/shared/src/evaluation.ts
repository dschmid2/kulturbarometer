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
  comments: { shown: true; items: string[] } | { shown: false; reason: 'ZU_WENIGE_ANTWORTEN' };
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
