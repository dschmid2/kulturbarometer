/**
 * Verteilung über den öffentlichen Kampagnen-Link (Anforderung 7) und Teilnahme (Anforderung 8).
 *
 * Anonymität:
 * - Die Teilnahmekennung ist ein zufälliger Code aus dem Browser. Gespeichert wird nur ein Hash
 *   je Kampagne (SHA-256 aus Kampagne und Code), damit Kennungen verschiedener Kampagnen nicht
 *   verknüpfbar sind (7.6).
 * - Die gespeicherte Antwort (`participation`, `answer_item`) enthält keinen Verweis auf Link,
 *   Kennung oder Sitzung und nur den Kalendertag (7.19, 8.9).
 */
import { randomBytes, randomInt, createHash } from 'node:crypto';
import {
  answerSubmissionSchema,
  drawBalanced,
  round2,
  type ItemType,
  type Perspective,
} from '@kb/shared';
import { Router } from 'express';
import { z } from 'zod';
import { orgId, requireRole } from '../auth/guard.js';
import type { Sql, Tx } from '../db/client.js';
import { AppError, notFound } from '../http/errors.js';

// ---------------------------------------------------------------------------
// Administration: Kampagnen-Link (7.1, 7.2, 7.15, 7.16)
// ---------------------------------------------------------------------------

export interface CampaignLinkDto {
  token: string;
  createdAt: string;
}

/** Zufälliger, URL-tauglicher Link-Token (144 Bit). */
const newToken = () => randomBytes(18).toString('base64url');

async function campaignOf(sql: Sql | Tx, org: string, id: string) {
  const [c] = await sql<{ status: string; distributionMode: string }[]>`
    select status, distribution_mode as "distributionMode"
    from campaign where id = ${id} and organization_id = ${org}`;
  if (!c) throw notFound('Die Kampagne');
  return c;
}

export async function getCampaignLink(
  sql: Sql,
  org: string,
  campaignId: string,
): Promise<CampaignLinkDto | null> {
  await campaignOf(sql, org, campaignId);
  const [link] = await sql<{ token: string; createdAt: Date }[]>`
    select link_token as token, created_at as "createdAt"
    from campaign_link where campaign_id = ${campaignId} and revoked_at is null`;
  return link ? { token: link.token, createdAt: link.createdAt.toISOString() } : null;
}

/** Erzeugt einen neuen Link; ein bestehender wird in derselben Transaktion ungültig (7.15). */
export async function createOrReplaceCampaignLink(
  sql: Sql,
  org: string,
  campaignId: string,
): Promise<CampaignLinkDto> {
  return sql.begin(async (tx) => {
    const [c] = await tx<{ status: string; distributionMode: string }[]>`
      select status, distribution_mode as "distributionMode"
      from campaign where id = ${campaignId} and organization_id = ${org} for update`;
    if (!c) throw notFound('Die Kampagne');
    if (c.status !== 'AKTIV') {
      throw new AppError(
        409,
        'CAMPAIGN_NOT_ACTIVE',
        'Ein Umfrage-Link kann nur für eine aktive Kampagne erzeugt werden.',
      );
    }
    if (c.distributionMode !== 'PUBLIC_LINK') {
      throw new AppError(409, 'WRONG_DISTRIBUTION_MODE', 'Die Kampagne verwendet Einmal-Links.');
    }
    await tx`update campaign_link set revoked_at = now()
             where campaign_id = ${campaignId} and revoked_at is null`;
    const [link] = await tx<{ token: string; createdAt: Date }[]>`
      insert into campaign_link (campaign_id, link_token) values (${campaignId}, ${newToken()})
      returning link_token as token, created_at as "createdAt"`;
    return { token: link!.token, createdAt: link!.createdAt.toISOString() };
  });
}

export function campaignLinkRouter(sql: () => Sql): Router {
  const r = Router();
  const role = requireRole('KAMPAGNEN');
  r.get('/campaigns/:id/link', role, async (req, res) => {
    res.json(await getCampaignLink(sql(), orgId(req), String(req.params.id)));
  });
  r.post('/campaigns/:id/link', role, async (req, res) => {
    res
      .status(201)
      .json(await createOrReplaceCampaignLink(sql(), orgId(req), String(req.params.id)));
  });
  return r;
}

// ---------------------------------------------------------------------------
// Teilnahme: öffnen und absenden (7.3–7.4, 7.11–7.13, 7.17, 8.1–8.15)
// ---------------------------------------------------------------------------

export interface SurveyItemDto {
  id: string;
  text: string;
  itemType: ItemType;
  perspective: Perspective;
}

export type OpenSurveyResult =
  | {
      state: 'OK';
      campaignId: string;
      title: string;
      items: SurveyItemDto[];
      /** Anzahl der verfügbaren (aktiven) Fragen der Kampagne – für den Hinweis zur Auswahl. */
      poolSize: number;
    }
  | { state: 'UNAVAILABLE' }
  | { state: 'ALREADY_PARTICIPATED' };

const participantCodeSchema = z.object({
  code: z.string().min(16, 'Ungültige Teilnahmekennung.').max(200, 'Ungültige Teilnahmekennung.'),
});

/** Hash der Teilnahmekennung je Kampagne – der Server sieht den Code selbst nie dauerhaft. */
export const participantHash = (campaignId: string, code: string) =>
  createHash('sha256').update(`${campaignId}:${code}`).digest('hex');

const invalidLink = () =>
  new AppError(404, 'INVALID_LINK', 'Dieser Umfrage-Link ist ungültig oder nicht mehr gültig.');

interface LinkedCampaign {
  id: string;
  title: string;
  status: string;
  itemsPerParticipant: number | null;
}

async function campaignForToken(sql: Sql | Tx, token: string, lock = false) {
  const [c] = await sql<LinkedCampaign[]>`
    select c.id, c.title, c.status, c.items_per_participant as "itemsPerParticipant"
    from campaign_link l join campaign c on c.id = l.campaign_id
    where l.link_token = ${token} and l.revoked_at is null
    ${lock ? sql`for update of c` : sql``}`;
  if (!c) throw invalidLink();
  return c;
}

/** Aktive (nicht deaktivierte) Snapshot-Items der Kampagne, optional eingeschränkt. */
interface PoolItem extends SurveyItemDto {
  /** Wert mit der höchsten Gewichtung; Grundlage der ausgewogenen Ziehung (8.18). */
  primaryValueId: string;
}

async function activeItems(sql: Sql | Tx, campaignId: string, only?: string[]) {
  return sql<PoolItem[]>`
    select si.id, si.text, si.item_type as "itemType", si.perspective,
           coalesce((select sa.value_id::text from snapshot_assignment sa
                     where sa.snapshot_item_id = si.id
                     order by sa.weight desc, sa.value_id limit 1), '') as "primaryValueId"
    from snapshot_item si
    where si.campaign_id = ${campaignId} and si.deactivated_at is null
      ${only ? sql`and si.id = any(${only}::uuid[])` : sql``}`;
}

async function activeCount(sql: Sql | Tx, campaignId: string) {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from snapshot_item
    where campaign_id = ${campaignId} and deactivated_at is null`;
  return row!.n;
}

/** Nur die für Teilnehmende bestimmten Felder ausgeben. */
const toDto = ({ id, text, itemType, perspective }: PoolItem): SurveyItemDto => ({
  id,
  text,
  itemType,
  perspective,
});

export async function openSurvey(
  sql: Sql,
  token: string,
  body: unknown,
): Promise<OpenSurveyResult> {
  const { code } = participantCodeSchema.parse(body);
  return sql.begin(async (tx) => {
    const c = await campaignForToken(tx, token, true);
    // Entwurf und abgeschlossen: einheitlicher Hinweis ohne Unterscheidung (7.11)
    if (c.status !== 'AKTIV') return { state: 'UNAVAILABLE' };
    const hash = participantHash(c.id, code);
    const [marker] = await tx`
      select 1 from participant_marker
      where campaign_id = ${c.id} and code_hash = ${hash} and status = 'TEILGENOMMEN'`;
    if (marker) return { state: 'ALREADY_PARTICIPATED' };

    // Bestehende Teilmenge wiederverwenden, ohne inzwischen deaktivierte Items (8.11, 8.12)
    const [session] = await tx<{ drawn: string[] }[]>`
      select drawn_snapshot_item_ids as drawn from survey_session
      where campaign_id = ${c.id} and access_key_hash = ${hash}`;
    if (session) {
      const items = await activeItems(tx, c.id, session.drawn);
      if (items.length === 0) return { state: 'UNAVAILABLE' };
      return {
        state: 'OK',
        campaignId: c.id,
        title: c.title,
        items: inOrder(items, session.drawn),
        poolSize: await activeCount(tx, c.id),
      };
    }

    // Erstes Öffnen: zufällige, ausgewogene Teilmenge aus den aktiven Items ziehen (8.1, 8.18):
    // gleich viele Fragen je Hauptwert und darin je Perspektive
    const pool = await activeItems(tx, c.id);
    if (pool.length === 0) return { state: 'UNAVAILABLE' };
    const k = Math.min(c.itemsPerParticipant ?? pool.length, pool.length);
    const drawn = drawBalanced(
      pool,
      k,
      [(i) => i.primaryValueId, (i) => i.perspective],
      () => randomInt(0, 2 ** 32) / 2 ** 32,
    ).map((i) => i.id);
    await tx`insert into survey_session (campaign_id, access_key_hash, drawn_snapshot_item_ids)
             values (${c.id}, ${hash}, ${drawn}::uuid[])`;
    return {
      state: 'OK',
      campaignId: c.id,
      title: c.title,
      items: inOrder(pool, drawn),
      poolSize: pool.length,
    };
  });
}

const inOrder = (items: PoolItem[], order: string[]) => {
  const byId = new Map(items.map((i) => [i.id, i]));
  return order.flatMap((id) => (byId.has(id) ? [toDto(byId.get(id)!)] : []));
};

const submitSchema = participantCodeSchema.extend(answerSubmissionSchema.shape);

/**
 * Speichert eine Antwort in einer Transaktion (8.6): Antwort ohne Verweise anlegen, Kennung als
 * „teilgenommen“ markieren, Sitzung löschen (7.19, 8.10, 8.14).
 */
export async function submitAnswer(
  sql: Sql,
  token: string,
  body: unknown,
): Promise<{ state: 'SUBMITTED' } | { state: 'UNAVAILABLE' } | { state: 'ALREADY_PARTICIPATED' }> {
  const input = submitSchema.parse(body);
  return sql.begin(async (tx) => {
    // Sperrt die Kampagne: fortlaufende Abgabenummer und keine doppelte Abgabe bei Nebenläufigkeit
    const c = await campaignForToken(tx, token, true);
    if (c.status !== 'AKTIV') return { state: 'UNAVAILABLE' };
    const hash = participantHash(c.id, input.code);
    const [marker] = await tx`
      select 1 from participant_marker
      where campaign_id = ${c.id} and code_hash = ${hash} and status = 'TEILGENOMMEN'`;
    if (marker) return { state: 'ALREADY_PARTICIPATED' };

    // Die Teilmenge kommt aus der Sitzung, nie vom Client (Design SurveyModule)
    const [session] = await tx<{ drawn: string[] }[]>`
      select drawn_snapshot_item_ids as drawn from survey_session
      where campaign_id = ${c.id} and access_key_hash = ${hash}`;
    if (!session) {
      throw new AppError(
        409,
        'SESSION_MISSING',
        'Die Umfrage wurde in diesem Browser noch nicht geöffnet. Bitte laden Sie die Seite neu.',
      );
    }
    const drawn = new Set(session.drawn);
    const required = await activeItems(tx, c.id, session.drawn);
    if (required.length === 0) return { state: 'UNAVAILABLE' };

    const answers = new Map<string, { rating: number; comment: string | null }>();
    for (const a of input.answers) {
      if (!drawn.has(a.snapshotItemId)) {
        throw new AppError(422, 'ITEM_NOT_IN_SUBSET', 'Die Antwort enthält eine fremde Frage.');
      }
      const comment = a.comment?.trim() ? a.comment.trim() : null;
      answers.set(a.snapshotItemId, { rating: round2(a.rating), comment });
    }
    const missing = required.filter((i) => !answers.has(i.id)).map((i) => i.id);
    if (missing.length > 0) {
      throw new AppError(
        422,
        'MISSING_RATINGS',
        `Bitte bewerten Sie noch ${missing.length === 1 ? 'eine Frage' : `${missing.length} Fragen`}.`,
        { missing },
      );
    }

    const [next] = await tx<{ seq: number }[]>`
      select coalesce(max(submission_seq), 0) + 1 as seq from participation
      where campaign_id = ${c.id}`;
    const seq = next!.seq;
    const [p] = await tx<{ id: string }[]>`
      insert into participation (campaign_id, submitted_on, submission_seq, drawn_snapshot_item_ids)
      values (${c.id}, current_date, ${seq}, ${session.drawn}::uuid[]) returning id`;
    const rows = [...answers].map(([snapshotItemId, a]) => ({
      participation_id: p!.id,
      snapshot_item_id: snapshotItemId,
      rating: a.rating,
      comment: a.comment,
    }));
    await tx`insert into answer_item ${tx(rows, 'participation_id', 'snapshot_item_id', 'rating', 'comment')}`;
    await tx`
      insert into participant_marker (campaign_id, code_hash, status)
      values (${c.id}, ${hash}, 'TEILGENOMMEN')
      on conflict (campaign_id, code_hash) do update set status = 'TEILGENOMMEN'`;
    await tx`delete from survey_session where campaign_id = ${c.id} and access_key_hash = ${hash}`;
    return { state: 'SUBMITTED' };
  });
}

/** Öffentliche Routen der Teilnahme – ohne Anmeldung, ohne personenbezogene Daten. */
export function surveyRouter(sql: () => Sql): Router {
  const r = Router();
  r.post('/survey/:token/open', async (req, res) => {
    res.json(await openSurvey(sql(), String(req.params.token), req.body));
  });
  r.post('/survey/:token/submit', async (req, res) => {
    const result = await submitAnswer(sql(), String(req.params.token), req.body);
    res.status(result.state === 'SUBMITTED' ? 201 : 200).json(result);
  });
  return r;
}
