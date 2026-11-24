/**
 * Auswertung einer Kampagne und Entwicklung über abgeschlossene Kampagnen (Anforderung 9 und 10).
 * Berechnet wird ausschliesslich mit den reinen Funktionen aus @kb/shared; an den Client geht nur
 * das Anzeigemodell nach Anwendung der Anonymitätsschwelle – unterdrückte Zahlen verlassen den
 * Server nicht.
 */
import {
  applyAnonymityThreshold,
  buildValueTrends,
  computeCampaignResult,
  type CampaignEvaluation,
  type CampaignStatus,
  type ParticipationInput,
  type Perspective,
  type SnapshotItemInput,
  type TrendResult,
} from '@kb/shared';
import { Router } from 'express';
import { orgId, requireRole } from '../auth/guard.js';
import type { Sql } from '../db/client.js';
import { notFound } from '../http/errors.js';

export interface CampaignEvaluationDto {
  campaign: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    status: CampaignStatus;
    anonymityThreshold: number;
  };
  evaluation: CampaignEvaluation;
}

interface CampaignHead {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: CampaignStatus;
  anonymityThreshold: number;
}

async function loadHeads(sql: Sql, org: string, filter: { id?: string; closedOnly?: boolean }) {
  return sql<CampaignHead[]>`
    select c.id, c.title, to_char(c.start_date, 'YYYY-MM-DD') as "startDate",
           to_char(c.end_date, 'YYYY-MM-DD') as "endDate", c.status,
           c.anonymity_threshold as "anonymityThreshold"
    from campaign c
    where c.organization_id = ${org}
      ${filter.id ? sql`and c.id = ${filter.id}` : sql``}
      ${filter.closedOnly ? sql`and c.status = 'ABGESCHLOSSEN'` : sql``}
    order by c.end_date, c.start_date`;
}

/** Lädt Snapshot und Antworten einer Kampagne und berechnet das Anzeigemodell. */
async function evaluate(sql: Sql, head: CampaignHead): Promise<CampaignEvaluation> {
  if (head.status === 'ENTWURF') return { state: 'ENTWURF' };

  const items = await sql<
    {
      id: string;
      perspective: Perspective;
      deactivatedAt: Date | null;
      text: string;
      assignments: { valueId: string; valueName: string; weight: number }[];
    }[]
  >`
    select si.id, si.perspective, si.deactivated_at as "deactivatedAt", si.text,
           coalesce(json_agg(json_build_object(
             'valueId', sa.value_id, 'valueName', sa.value_name_at_snapshot, 'weight', sa.weight
           )) filter (where sa.id is not null), '[]') as assignments
    from snapshot_item si
    left join snapshot_assignment sa on sa.snapshot_item_id = si.id
    where si.campaign_id = ${head.id}
    group by si.id`;

  const answers = await sql<
    {
      participationId: string;
      submissionSeq: number;
      snapshotItemId: string;
      rating: number;
      comment: string | null;
    }[]
  >`
    select p.id as "participationId", p.submission_seq as "submissionSeq",
           a.snapshot_item_id as "snapshotItemId", a.rating, a.comment
    from participation p
    join answer_item a on a.participation_id = p.id
    where p.campaign_id = ${head.id}`;
  const [{ count: participationCount } = { count: 0 }] = await sql<{ count: number }[]>`
    select count(*)::int as count from participation where campaign_id = ${head.id}`;

  const values = new Map<string, string>();
  const snapshotItems: SnapshotItemInput[] = items.map((i) => {
    for (const a of i.assignments) if (!values.has(a.valueId)) values.set(a.valueId, a.valueName);
    return {
      id: i.id,
      perspective: i.perspective,
      deactivatedAt: i.deactivatedAt,
      text: i.text,
      assignments: i.assignments.map((a) => ({ valueId: a.valueId, weight: Number(a.weight) })),
    };
  });

  const byParticipation = new Map<
    string,
    ParticipationInput & { ratings: ParticipationInput['ratings'][number][] }
  >();
  for (const a of answers) {
    let p = byParticipation.get(a.participationId);
    if (!p) {
      p = { id: a.participationId, submissionSeq: a.submissionSeq, ratings: [] };
      byParticipation.set(a.participationId, p);
    }
    p.ratings.push({
      snapshotItemId: a.snapshotItemId,
      rating: Number(a.rating),
      comment: a.comment,
    });
  }
  // Abgaben ohne Antworten zählen dennoch als Teilnahme.
  if (byParticipation.size < participationCount) {
    const seqs = await sql<{ id: string; submissionSeq: number }[]>`
      select id, submission_seq as "submissionSeq" from participation where campaign_id = ${head.id}`;
    for (const s of seqs)
      if (!byParticipation.has(s.id)) byParticipation.set(s.id, { ...s, ratings: [] });
  }

  const result = computeCampaignResult({
    status: head.status,
    threshold: head.anonymityThreshold,
    values: [...values].map(([id, name]) => ({ id, name })),
    snapshotItems,
    participations: [...byParticipation.values()],
  });
  return applyAnonymityThreshold(head.status, head.anonymityThreshold, result);
}

export async function getCampaignEvaluation(
  sql: Sql,
  org: string,
  id: string,
): Promise<CampaignEvaluationDto> {
  const [head] = await loadHeads(sql, org, { id });
  if (!head) throw notFound('Die Kampagne');
  return { campaign: head, evaluation: await evaluate(sql, head) };
}

/** Verlauf aller Werte über die abgeschlossenen Kampagnen der Unternehmung (10.4, 10.15). */
export async function getValueTrends(sql: Sql, org: string): Promise<TrendResult> {
  const heads = await loadHeads(sql, org, { closedOnly: true });
  const evaluated = [];
  for (const h of heads) evaluated.push({ ...h, evaluation: await evaluate(sql, h) });
  const current = await sql<{ id: string; name: string }[]>`
    select id, name from value where organization_id = ${org}`;
  return buildValueTrends(evaluated, new Map(current.map((v) => [v.id, v.name])));
}

export function evaluationRouter(sql: () => Sql): Router {
  const r = Router();
  const role = requireRole('KAMPAGNEN');
  r.get('/campaigns/:id/evaluation', role, async (req, res) => {
    res.json(await getCampaignEvaluation(sql(), orgId(req), String(req.params.id)));
  });
  r.get('/evaluation/trends', role, async (req, res) => {
    res.json(await getValueTrends(sql(), orgId(req)));
  });
  return r;
}
