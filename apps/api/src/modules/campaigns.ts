/** Kampagnen: Entwurf, Pool, Aktivierung mit Snapshot, Abschluss (Anforderung 6). */
import {
  ANONYMITY_THRESHOLD_DEFAULT,
  campaignInputSchema,
  campaignPoolSchema,
  campaignSettingsSchema,
  type CampaignStatus,
  type ItemType,
  type Perspective,
} from '@kb/shared';
import { Router } from 'express';
import { orgId, requireRole } from '../auth/guard.js';
import type { Sql, Tx } from '../db/client.js';
import { AppError, notFound } from '../http/errors.js';

export interface CampaignSummaryDto {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: CampaignStatus;
  itemsPerParticipant: number | null;
  anonymityThreshold: number;
  poolSize: number;
  activatedAt: string | null;
  closedAt: string | null;
}

export interface CampaignItemDto {
  /** Item-Version (im Entwurf) bzw. Snapshot-Eintrag (nach der Aktivierung). */
  id: string;
  itemVersionId: string;
  text: string;
  itemType: ItemType;
  perspective: Perspective;
  deactivatedAt: string | null;
  assignments: { valueId: string; valueName: string; weight: number }[];
}

export interface CampaignDetailDto extends CampaignSummaryDto {
  /** Entwurf: aktueller Pool; aktiv/abgeschlossen: eingefrorener Snapshot (6.13). */
  items: CampaignItemDto[];
  /** Aus den Werte-Zuordnungen der Fragen abgeleitete Unternehmenswerte (6.4). */
  values: { id: string; name: string }[];
}

interface CampaignRow {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: CampaignStatus;
  itemsPerParticipant: number | null;
  anonymityThreshold: number;
  activatedAt: Date | null;
  closedAt: Date | null;
  poolSize: number;
}

const toSummary = (r: CampaignRow): CampaignSummaryDto => ({
  id: r.id,
  title: r.title,
  startDate: r.startDate,
  endDate: r.endDate,
  status: r.status,
  itemsPerParticipant: r.itemsPerParticipant,
  anonymityThreshold: r.anonymityThreshold,
  poolSize: r.poolSize,
  activatedAt: r.activatedAt?.toISOString() ?? null,
  closedAt: r.closedAt?.toISOString() ?? null,
});

async function loadCampaigns(sql: Sql | Tx, org: string, id?: string): Promise<CampaignRow[]> {
  return sql<CampaignRow[]>`
    select c.id, c.title, to_char(c.start_date, 'YYYY-MM-DD') as "startDate",
           to_char(c.end_date, 'YYYY-MM-DD') as "endDate", c.status,
           c.items_per_participant as "itemsPerParticipant", c.anonymity_threshold as "anonymityThreshold",
           c.activated_at as "activatedAt", c.closed_at as "closedAt",
           case when c.status = 'ENTWURF'
                then (select count(*) from campaign_pool_item p where p.campaign_id = c.id)
                else (select count(*) from snapshot_item s where s.campaign_id = c.id) end::int as "poolSize"
    from campaign c
    where c.organization_id = ${org} ${id ? sql`and c.id = ${id}` : sql``}
    order by c.start_date desc, c.created_at desc`;
}

export async function listCampaigns(sql: Sql, org: string): Promise<CampaignSummaryDto[]> {
  return (await loadCampaigns(sql, org)).map(toSummary);
}

export async function getCampaign(
  sql: Sql | Tx,
  org: string,
  id: string,
): Promise<CampaignDetailDto> {
  const [row] = await loadCampaigns(sql, org, id);
  if (!row) throw notFound('Die Kampagne');
  let items: CampaignItemDto[];
  if (row.status === 'ENTWURF') {
    const rows = await sql<Omit<CampaignItemDto, 'assignments'>[]>`
      select i.id, i.id as "itemVersionId", i.text, i.item_type as "itemType", i.perspective,
             null::text as "deactivatedAt"
      from campaign_pool_item p join item i on i.id = p.item_id
      where p.campaign_id = ${id} order by i.created_at`;
    const assignments = await sql<
      { itemId: string; valueId: string; valueName: string; weight: number }[]
    >`
      select va.item_id as "itemId", va.value_id as "valueId", v.name as "valueName", va.weight
      from campaign_pool_item p
      join value_assignment va on va.item_id = p.item_id
      join value v on v.id = va.value_id
      where p.campaign_id = ${id}
      order by va.weight desc, v.name`;
    items = rows.map((r) => ({
      ...r,
      assignments: assignments
        .filter((a) => a.itemId === r.id)
        .map(({ valueId, valueName, weight }) => ({ valueId, valueName, weight })),
    }));
  } else {
    const rows = await sql<
      (Omit<CampaignItemDto, 'assignments' | 'deactivatedAt'> & { deactivatedAt: Date | null })[]
    >`
      select s.id, s.item_version_id as "itemVersionId", s.text, s.item_type as "itemType", s.perspective,
             s.deactivated_at as "deactivatedAt"
      from snapshot_item s where s.campaign_id = ${id} order by s.id`;
    const assignments = await sql<
      { itemId: string; valueId: string; valueName: string; weight: number }[]
    >`
      select sa.snapshot_item_id as "itemId", sa.value_id as "valueId",
             sa.value_name_at_snapshot as "valueName", sa.weight
      from snapshot_assignment sa join snapshot_item s on s.id = sa.snapshot_item_id
      where s.campaign_id = ${id}
      order by sa.weight desc, sa.value_name_at_snapshot`;
    items = rows.map((r) => ({
      ...r,
      deactivatedAt: r.deactivatedAt?.toISOString() ?? null,
      assignments: assignments
        .filter((a) => a.itemId === r.id)
        .map(({ valueId, valueName, weight }) => ({ valueId, valueName, weight })),
    }));
  }
  const values = new Map<string, string>();
  for (const item of items)
    for (const a of item.assignments) if (a.weight > 0) values.set(a.valueId, a.valueName);
  return {
    ...toSummary(row),
    items,
    values: [...values]
      .map(([vid, name]) => ({ id: vid, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
  };
}

export async function createCampaign(
  sql: Sql,
  org: string,
  body: unknown,
): Promise<CampaignDetailDto> {
  const { title, startDate, endDate } = campaignInputSchema.parse(body);
  const [row] = await sql<{ id: string }[]>`
    insert into campaign (organization_id, title, start_date, end_date, anonymity_threshold)
    values (${org}, ${title.trim()}, ${startDate}, ${endDate}, ${ANONYMITY_THRESHOLD_DEFAULT})
    returning id`;
  return getCampaign(sql, org, row!.id);
}

async function lockDraft(tx: Tx, org: string, id: string): Promise<void> {
  const [c] = await tx<{ status: CampaignStatus }[]>`
    select status from campaign where id = ${id} and organization_id = ${org} for update`;
  if (!c) throw notFound('Die Kampagne');
  if (c.status !== 'ENTWURF') {
    throw new AppError(
      409,
      'SNAPSHOT_IMMUTABLE',
      'Die Kampagne ist aktiviert; Pool und Einstellungen sind eingefroren.',
    );
  }
}

/** Titel, Zeitraum, Fragen je Teilnehmer und Anonymitätsschwelle im Entwurf ändern (6.1–6.6, 6.28–6.30). */
export async function updateCampaignSettings(
  sql: Sql,
  org: string,
  id: string,
  body: unknown,
): Promise<CampaignDetailDto> {
  const s = campaignSettingsSchema.parse(body);
  await sql.begin(async (tx) => {
    await lockDraft(tx, org, id);
    await tx`
      update campaign set title = ${s.title.trim()}, start_date = ${s.startDate}, end_date = ${s.endDate},
             items_per_participant = ${s.itemsPerParticipant}, anonymity_threshold = ${s.anonymityThreshold}
      where id = ${id}`;
  });
  return getCampaign(sql, org, id);
}

/**
 * Pool vollständig ersetzen (6.4, 6.5). Nur freigegebene Fragen der eigenen Unternehmung;
 * sonst wird die Änderung abgelehnt und der Pool bleibt unverändert.
 */
export async function setCampaignPool(
  sql: Sql,
  org: string,
  id: string,
  body: unknown,
): Promise<CampaignDetailDto> {
  const ids = [...new Set(campaignPoolSchema.parse(body).itemIds)];
  await sql.begin(async (tx) => {
    await lockDraft(tx, org, id);
    if (ids.length > 0) {
      const found = await tx<{ id: string; status: string; text: string }[]>`
        select id, status, text from item where id = any(${ids}::uuid[]) and organization_id = ${org} for share`;
      if (found.length !== ids.length) throw notFound('Mindestens eine Frage');
      const notApproved = found.filter((i) => i.status !== 'FREIGEGEBEN');
      if (notApproved.length > 0) {
        throw new AppError(
          422,
          'ITEM_NOT_APPROVED',
          `Nur freigegebene Fragen können verwendet werden. Nicht freigegeben: ${notApproved
            .map((i) => `„${i.text}"`)
            .join(', ')}`,
        );
      }
    }
    await tx`delete from campaign_pool_item where campaign_id = ${id}`;
    if (ids.length > 0) {
      await tx`
        insert into campaign_pool_item (campaign_id, item_id)
        select ${id}, unnest(${ids}::uuid[])`;
    }
  });
  return getCampaign(sql, org, id);
}

/**
 * Aktivierung (6.9–6.13) in einer Transaktion: Prüfungen, Snapshot einfrieren,
 * Fragen als verwendet kennzeichnen, Status auf „Aktiv".
 */
export async function activateCampaign(
  sql: Sql,
  org: string,
  id: string,
): Promise<CampaignDetailDto> {
  await sql.begin(async (tx) => {
    await lockDraft(tx, org, id);
    const [c] = await tx<{ itemsPerParticipant: number | null }[]>`
      select items_per_participant as "itemsPerParticipant" from campaign where id = ${id}`;
    // Pool-Fragen sperren, damit parallele Bearbeitung oder Deaktivierung nicht dazwischenkommt.
    const pool = await tx<
      { id: string; status: string; text: string; itemType: string; perspective: string }[]
    >`
      select i.id, i.status, i.text, i.item_type as "itemType", i.perspective
      from campaign_pool_item p join item i on i.id = p.item_id
      where p.campaign_id = ${id}
      order by i.created_at
      for update of i`;
    if (pool.length === 0) {
      throw new AppError(422, 'EMPTY_POOL', 'Die Kampagne braucht mindestens eine Frage.');
    }
    const n = c!.itemsPerParticipant;
    if (n === null || n < 1 || n > pool.length) {
      throw new AppError(
        422,
        'INVALID_ITEMS_PER_PARTICIPANT',
        `Die Anzahl Fragen je Teilnehmer muss zwischen 1 und ${pool.length} (Grösse des Pools) liegen.`,
      );
    }
    const notApproved = pool.filter((i) => i.status !== 'FREIGEGEBEN');
    if (notApproved.length > 0) {
      throw new AppError(
        422,
        'ITEM_NOT_APPROVED',
        `Diese Fragen sind nicht mehr freigegeben: ${notApproved.map((i) => `„${i.text}"`).join(', ')}`,
      );
    }
    for (const item of pool) {
      const [snap] = await tx<{ id: string }[]>`
        insert into snapshot_item (campaign_id, item_version_id, text, item_type, perspective)
        values (${id}, ${item.id}, ${item.text}, ${item.itemType}, ${item.perspective})
        returning id`;
      await tx`
        insert into snapshot_assignment (snapshot_item_id, value_id, value_name_at_snapshot, weight)
        select ${snap!.id}, va.value_id, v.name, va.weight
        from value_assignment va join value v on v.id = va.value_id
        where va.item_id = ${item.id}`;
    }
    await tx`
      update item set used_at = now()
      where id = any(${pool.map((i) => i.id)}::uuid[]) and used_at is null`;
    await tx`update campaign set status = 'AKTIV', activated_at = now() where id = ${id}`;
  });
  return getCampaign(sql, org, id);
}

/** Abschluss (6.25, 6.26): nur aus „Aktiv". */
export async function closeCampaign(sql: Sql, org: string, id: string): Promise<CampaignDetailDto> {
  const rows = await sql`
    update campaign set status = 'ABGESCHLOSSEN', closed_at = now()
    where id = ${id} and organization_id = ${org} and status = 'AKTIV' returning id`;
  if (rows.length === 0) {
    const [exists] = await loadCampaigns(sql, org, id);
    if (!exists) throw notFound('Die Kampagne');
    throw new AppError(
      409,
      'INVALID_STATUS_TRANSITION',
      'Nur aktive Kampagnen können abgeschlossen werden.',
    );
  }
  return getCampaign(sql, org, id);
}

/** Entwürfe dürfen gelöscht werden; aktivierte Kampagnen bleiben für die Auswertung erhalten. */
export async function deleteCampaign(sql: Sql, org: string, id: string): Promise<void> {
  await sql.begin(async (tx) => {
    await lockDraft(tx, org, id);
    await tx`delete from campaign where id = ${id}`;
  });
}

export function campaignsRouter(sql: () => Sql): Router {
  const r = Router();
  const role = requireRole('KAMPAGNEN');
  r.get('/campaigns', role, async (req, res) => {
    res.json(await listCampaigns(sql(), orgId(req)));
  });
  r.post('/campaigns', role, async (req, res) => {
    res.status(201).json(await createCampaign(sql(), orgId(req), req.body));
  });
  r.get('/campaigns/:id', role, async (req, res) => {
    res.json(await getCampaign(sql(), orgId(req), String(req.params.id)));
  });
  r.put('/campaigns/:id', role, async (req, res) => {
    res.json(await updateCampaignSettings(sql(), orgId(req), String(req.params.id), req.body));
  });
  r.put('/campaigns/:id/pool', role, async (req, res) => {
    res.json(await setCampaignPool(sql(), orgId(req), String(req.params.id), req.body));
  });
  r.post('/campaigns/:id/activate', role, async (req, res) => {
    res.json(await activateCampaign(sql(), orgId(req), String(req.params.id)));
  });
  r.post('/campaigns/:id/close', role, async (req, res) => {
    res.json(await closeCampaign(sql(), orgId(req), String(req.params.id)));
  });
  r.delete('/campaigns/:id', role, async (req, res) => {
    await deleteCampaign(sql(), orgId(req), String(req.params.id));
    res.status(204).end();
  });
  return r;
}
