/**
 * Ist-Score, Verteilung und Perspektivdifferenzen (Anforderung 9).
 * Alle Funktionen sind rein und ohne I/O, damit sie per Property-Based Testing geprüft werden können.
 */
import {
  DISTRIBUTION_CLASS_BOUNDS,
  PERSPECTIVES,
  type CampaignStatus,
  type Perspective,
} from './domain.js';
import { median, populationStdDev, round2 } from './math.js';

// ---------------------------------------------------------------------------
// Eingaben
// ---------------------------------------------------------------------------

export interface SnapshotAssignmentInput {
  valueId: string;
  weight: number;
}

export interface SnapshotItemInput {
  id: string;
  perspective: Perspective;
  /** `null` = aktiv; gesetzt = in der Kampagne deaktiviert. */
  deactivatedAt: Date | string | null;
  text?: string;
  assignments: readonly SnapshotAssignmentInput[];
}

export interface RatingInput {
  snapshotItemId: string;
  rating: number;
  comment?: string | null;
}

export interface ParticipationInput {
  id: string;
  submissionSeq: number;
  ratings: readonly RatingInput[];
}

export interface ValueRef {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Antwortauswahl und Vorfilter
// ---------------------------------------------------------------------------

/**
 * Wählt die einbezogenen Antworten (Anforderung 9.1, 10.12):
 * Endauswertung alle, Zwischenauswertung die ersten ⌊n/t⌋·t in Abgabereihenfolge.
 */
export function selectIncludedParticipations<P extends { submissionSeq: number }>(
  participations: readonly P[],
  status: CampaignStatus,
  threshold: number,
): P[] {
  const sorted = [...participations].sort((a, b) => a.submissionSeq - b.submissionSeq);
  if (status === 'ABGESCHLOSSEN') return sorted;
  if (status !== 'AKTIV') return [];
  const m = Math.floor(sorted.length / threshold) * threshold;
  return sorted.slice(0, m);
}

export interface ScorableRating {
  participationId: string;
  item: SnapshotItemInput;
  rating: number;
  comment: string | null;
}

/** Behält nur Bewertungen nicht deaktivierter Items, unabhängig vom Abgabezeitpunkt (9.1, 9.5). */
export function selectScorableRatings(
  snapshotItems: readonly SnapshotItemInput[],
  participations: readonly ParticipationInput[],
): ScorableRating[] {
  const byId = new Map(snapshotItems.map((i) => [i.id, i]));
  const result: ScorableRating[] = [];
  for (const p of participations) {
    for (const r of p.ratings) {
      const item = byId.get(r.snapshotItemId);
      if (!item || item.deactivatedAt !== null) continue;
      result.push({ participationId: p.id, item, rating: r.rating, comment: r.comment ?? null });
    }
  }
  return result;
}

/** Anzahl der wegen Deaktivierung ausgeschlossenen Bewertungen eines Items (9.6). */
export function countExcludedRatings(
  snapshotItemId: string,
  participations: readonly ParticipationInput[],
): number {
  let n = 0;
  for (const p of participations)
    for (const r of p.ratings) if (r.snapshotItemId === snapshotItemId) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Ist-Score
// ---------------------------------------------------------------------------

export interface WeightedRating {
  weight: number;
  rating: number;
}

/**
 * Gewichteter Mittelwert Σ(w·r)/Σ(w), ungerundet. `null` = „keine Daten",
 * wenn keine Zuordnung mit Gewichtung > 0 beiträgt (9.2, 9.3).
 */
export function computeIstScoreRaw(contributions: readonly WeightedRating[]): number | null {
  let num = 0;
  let den = 0;
  for (const c of contributions) {
    if (c.weight <= 0) continue;
    num += c.weight * c.rating;
    den += c.weight;
  }
  return den > 0 ? num / den : null;
}

/** Ist-Score auf zwei Nachkommastellen gerundet (9.2). */
export function computeIstScore(contributions: readonly WeightedRating[]): number | null {
  const raw = computeIstScoreRaw(contributions);
  return raw === null ? null : round2(raw);
}

function weightFor(item: SnapshotItemInput, valueId: string): number {
  return item.assignments.find((a) => a.valueId === valueId)?.weight ?? 0;
}

/** Beiträge eines Werts in einer Perspektive aus vorgefilterten Bewertungen. */
export function contributionsFor(
  ratings: readonly ScorableRating[],
  valueId: string,
  perspective: Perspective,
): Array<WeightedRating & { participationId: string }> {
  const out: Array<WeightedRating & { participationId: string }> = [];
  for (const r of ratings) {
    if (r.item.perspective !== perspective) continue;
    const weight = weightFor(r.item, valueId);
    if (weight <= 0) continue;
    out.push({ participationId: r.participationId, weight, rating: r.rating });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verteilung (9.8, 9.9)
// ---------------------------------------------------------------------------

/** Teilnehmer-Scores: je beitragender Antwort ein gewichteter Mittelwert. */
export function computeParticipantScores(
  contributions: ReadonlyArray<WeightedRating & { participationId: string }>,
): number[] {
  const groups = new Map<string, WeightedRating[]>();
  for (const c of contributions) {
    const list = groups.get(c.participationId) ?? [];
    list.push(c);
    groups.set(c.participationId, list);
  }
  const scores: number[] = [];
  for (const list of groups.values()) {
    const s = computeIstScoreRaw(list);
    if (s !== null) scores.push(s);
  }
  return scores;
}

/**
 * Index der Verteilungsklasse (0–4). Klassifiziert wird der auf zwei Stellen gerundete
 * Teilnehmer-Score, damit Rundungsfehler (1,7999…) nicht die Klasse verschieben.
 */
export function distributionClassOf(score: number): number {
  const s = round2(score);
  let idx = 0;
  for (const bound of DISTRIBUTION_CLASS_BOUNDS) if (s >= bound) idx++;
  return idx;
}

/** Breite der Feinintervalle der Verteilungsgrafik; jede Verteilungsklasse umfasst genau 4 davon. */
export const HISTOGRAM_BIN_WIDTH = 0.2;
export const HISTOGRAM_BINS = 20;

/**
 * Feinintervall (0–19) eines Teilnehmer-Scores: 1,00–1,19 → 0, …, 4,80–5,00 → 19. Gerechnet in
 * Hundertsteln des gerundeten Scores, damit die Grenzen exakt mit den Verteilungsklassen übereinstimmen.
 */
export function histogramBinOf(score: number): number {
  const hundredths = Math.round(round2(score) * 100);
  return Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor((hundredths - 100) / 20)));
}

export interface Distribution {
  classCounts: number[];
  classShares: number[];
  /** Teilnehmer je Feinintervall à 0,20 (20 Werte); summiert je 4 ergibt es `classCounts`. */
  histogram: number[];
  median: number;
  stdDev: number;
}

export function computeDistribution(participantScores: readonly number[]): Distribution | null {
  const n = participantScores.length;
  if (n === 0) return null;
  const classCounts = [0, 0, 0, 0, 0];
  const histogram = new Array<number>(HISTOGRAM_BINS).fill(0);
  for (const s of participantScores) {
    classCounts[distributionClassOf(s)]!++;
    histogram[histogramBinOf(s)]!++;
  }
  return {
    classCounts,
    classShares: classCounts.map((c) => Math.round((c / n) * 100)),
    histogram,
    median: round2(median(participantScores)),
    stdDev: round2(populationStdDev(participantScores)),
  };
}

// ---------------------------------------------------------------------------
// Perspektivdifferenzen (9.10)
// ---------------------------------------------------------------------------

export interface PerspectiveGaps {
  selbstTeam: number | null;
  selbstFuehrung: number | null;
  teamFuehrung: number | null;
}

export function computePerspectiveGaps(raw: Record<Perspective, number | null>): PerspectiveGaps {
  const diff = (a: number | null, b: number | null) =>
    a === null || b === null ? null : round2(a - b);
  return {
    selbstTeam: diff(raw.SELBST, raw.TEAM),
    selbstFuehrung: diff(raw.SELBST, raw.FUEHRUNG),
    teamFuehrung: diff(raw.TEAM, raw.FUEHRUNG),
  };
}

// ---------------------------------------------------------------------------
// Gesamtergebnis einer Kampagne (vor Anwendung der Anonymitätsschwelle)
// ---------------------------------------------------------------------------

export interface PerspectiveResult {
  istScoreRaw: number | null;
  istScore: number | null;
  ratingCount: number;
  contributors: number;
  distribution: Distribution | null;
}

export interface ValueResult {
  valueId: string;
  name: string;
  perspectives: Record<Perspective, PerspectiveResult>;
  gaps: PerspectiveGaps;
  /** Teilnehmer, die zu mindestens einer Perspektive dieses Werts beitragen (10.14). */
  contributorsAny: number;
  comments: ValueComment[];
}

/** Anonymer Freitextkommentar mit Kontext: Perspektive und Text der kommentierten Frage (10.3). */
export interface ValueComment {
  text: string;
  perspective: Perspective;
  itemText: string;
}

const PERSPECTIVE_ORDER: Record<Perspective, number> = { SELBST: 0, TEAM: 1, FUEHRUNG: 2 };

/**
 * Feste Reihenfolge nach Perspektive, Frage und Kommentartext – unabhängig von der Abgabe-
 * reihenfolge, damit sich Kommentare nicht einzelnen Teilnahmen zuordnen lassen.
 */
export function sortComments(comments: readonly ValueComment[]): ValueComment[] {
  return [...comments].sort(
    (a, b) =>
      PERSPECTIVE_ORDER[a.perspective] - PERSPECTIVE_ORDER[b.perspective] ||
      a.itemText.localeCompare(b.itemText, 'de', { numeric: true }) ||
      a.text.localeCompare(b.text, 'de', { numeric: true }),
  );
}

export interface DeactivatedItemResult {
  snapshotItemId: string;
  text: string;
  deactivatedAt: string;
  excludedRatings: number;
}

export interface CampaignResult {
  totalParticipations: number;
  includedParticipations: number;
  values: ValueResult[];
  deactivatedItems: DeactivatedItemResult[];
  /** Kampagnenweit „keine Daten" (9.4). */
  noData: boolean;
}

export function computeCampaignResult(input: {
  status: CampaignStatus;
  threshold: number;
  values: readonly ValueRef[];
  snapshotItems: readonly SnapshotItemInput[];
  participations: readonly ParticipationInput[];
}): CampaignResult {
  const included = selectIncludedParticipations(
    input.participations,
    input.status,
    input.threshold,
  );
  const scorable = selectScorableRatings(input.snapshotItems, included);

  const values: ValueResult[] = input.values.map((value) => {
    const perspectives = {} as Record<Perspective, PerspectiveResult>;
    const raw = {} as Record<Perspective, number | null>;
    const anyContributors = new Set<string>();
    for (const perspective of PERSPECTIVES) {
      const contributions = contributionsFor(scorable, value.id, perspective);
      const istScoreRaw = computeIstScoreRaw(contributions);
      const participantScores = computeParticipantScores(contributions);
      for (const c of contributions) anyContributors.add(c.participationId);
      raw[perspective] = istScoreRaw;
      perspectives[perspective] = {
        istScoreRaw,
        istScore: istScoreRaw === null ? null : round2(istScoreRaw),
        ratingCount: contributions.length,
        contributors: participantScores.length,
        distribution: computeDistribution(participantScores),
      };
    }
    const comments = sortComments(
      scorable
        .filter((r) => r.comment && r.comment.trim() !== '' && weightFor(r.item, value.id) > 0)
        .map((r) => ({
          text: r.comment as string,
          perspective: r.item.perspective,
          itemText: r.item.text ?? '',
        })),
    );
    return {
      valueId: value.id,
      name: value.name,
      perspectives,
      gaps: computePerspectiveGaps(raw),
      contributorsAny: anyContributors.size,
      comments,
    };
  });

  const deactivatedItems = input.snapshotItems
    .filter((i) => i.deactivatedAt !== null)
    .map((i) => ({
      snapshotItemId: i.id,
      text: i.text ?? '',
      deactivatedAt: new Date(i.deactivatedAt as string | Date).toISOString(),
      excludedRatings: countExcludedRatings(i.id, included),
    }));

  return {
    totalParticipations: input.participations.length,
    includedParticipations: included.length,
    values,
    deactivatedItems,
    noData: values.every((v) => PERSPECTIVES.every((p) => v.perspectives[p].istScoreRaw === null)),
  };
}
