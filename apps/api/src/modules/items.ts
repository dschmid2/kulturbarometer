/** Items verwalten inkl. Freigabe-Workflow und Versionierung (Anforderung 5). */
import {
  ITEM_STATUSES,
  itemInputSchema,
  type ItemInput,
  type ItemOrigin,
  type ItemStatus,
  type ItemType,
  type Perspective,
} from '@kb/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { Sql, Tx } from '../db/client.js';
import { AppError, notFound } from '../http/errors.js';

export interface ItemAssignmentDto {
  valueId: string;
  valueName: string;
  weight: number;
}

export interface ItemDto {
  id: string;
  familyId: string;
  versionNumber: number;
  predecessorId: string | null;
  text: string;
  itemType: ItemType;
  perspective: Perspective;
  status: ItemStatus;
  origin: ItemOrigin;
  used: boolean;
  assignments: ItemAssignmentDto[];
  updatedAt: string;
}

interface ItemRow {
  id: string;
  familyId: string;
  versionNumber: number;
  predecessorId: string | null;
  text: string;
  itemType: ItemType;
  perspective: Perspective;
  status: ItemStatus;
  origin: ItemOrigin;
  usedAt: Date | null;
  updatedAt: Date;
}

async function loadItems(sql: Sql | Tx, ids: readonly string[] | null): Promise<ItemDto[]> {
  const rows = await sql<ItemRow[]>`
    select id, family_id as "familyId", version_number as "versionNumber", predecessor_id as "predecessorId",
           text, item_type as "itemType", perspective, status, origin, used_at as "usedAt", updated_at as "updatedAt"
    from item
    ${ids ? sql`where id = any(${ids as string[]}::uuid[])` : sql``}
    order by created_at desc`;
  if (rows.length === 0) return [];
  const assignments = await sql<(ItemAssignmentDto & { itemId: string })[]>`
    select va.item_id as "itemId", va.value_id as "valueId", v.name as "valueName", va.weight
    from value_assignment va join value v on v.id = va.value_id
    where va.item_id = any(${rows.map((r) => r.id)}::uuid[])
    order by va.weight desc, v.name`;
  return rows.map((r) => ({
    id: r.id,
    familyId: r.familyId,
    versionNumber: r.versionNumber,
    predecessorId: r.predecessorId,
    text: r.text,
    itemType: r.itemType,
    perspective: r.perspective,
    status: r.status,
    origin: r.origin,
    used: r.usedAt !== null,
    updatedAt: r.updatedAt.toISOString(),
    assignments: assignments
      .filter((a) => a.itemId === r.id)
      .map(({ valueId, valueName, weight }) => ({ valueId, valueName, weight })),
  }));
}

export async function getItem(sql: Sql | Tx, id: string): Promise<ItemDto> {
  const [item] = await loadItems(sql, [id]);
  if (!item) throw notFound('Die Frage');
  return item;
}

/** Items, optional gefiltert nach Wert (Gewichtung > 0 %, 5.28) und Status. */
export async function listItems(
  sql: Sql,
  filter: { valueId?: string; status?: ItemStatus },
): Promise<ItemDto[]> {
  const ids = await sql<{ id: string }[]>`
    select i.id from item i
    where true
      ${filter.status ? sql`and i.status = ${filter.status}` : sql``}
      ${
        filter.valueId
          ? sql`and exists (select 1 from value_assignment va where va.item_id = i.id and va.value_id = ${filter.valueId} and va.weight > 0)`
          : sql``
      }`;
  return loadItems(
    sql,
    ids.map((r) => r.id),
  );
}

async function assertValuesExist(tx: Tx, input: ItemInput): Promise<void> {
  const ids = input.assignments.map((a) => a.valueId);
  const found = await tx<{ id: string }[]>`select id from value where id = any(${ids}::uuid[])`;
  if (found.length !== new Set(ids).size) {
    throw new AppError(
      422,
      'UNKNOWN_VALUE',
      'Mindestens ein zugeordneter Unternehmenswert existiert nicht.',
      {
        assignments: ['Mindestens ein zugeordneter Unternehmenswert existiert nicht.'],
      },
    );
  }
}

async function insertAssignments(tx: Tx, itemId: string, input: ItemInput): Promise<void> {
  for (const a of input.assignments) {
    await tx`insert into value_assignment (item_id, value_id, weight) values (${itemId}, ${a.valueId}, ${a.weight})`;
  }
}

/** Neues Item als Version 1 einer neuen Familie im Status „zur Prüfung" (5.1). */
export async function createItemInTx(
  tx: Tx,
  input: ItemInput,
  origin: ItemOrigin,
): Promise<string> {
  await assertValuesExist(tx, input);
  const [family] = await tx<{ id: string }[]>`insert into item_family default values returning id`;
  const [item] = await tx<{ id: string }[]>`
    insert into item (family_id, version_number, text, item_type, perspective, status, origin)
    values (${family!.id}, 1, ${input.text}, ${input.itemType}, ${input.perspective}, 'ZUR_PRUEFUNG', ${origin})
    returning id`;
  await insertAssignments(tx, item!.id, input);
  return item!.id;
}

export async function createItem(
  sql: Sql,
  body: unknown,
  origin: ItemOrigin = 'MANUELL',
): Promise<ItemDto> {
  const input = itemInputSchema.parse(body);
  const id = await sql.begin((tx) => createItemInTx(tx, input, origin));
  return getItem(sql, id);
}

/**
 * Neue Version einer verwendeten Item-Version (5.21–5.23): Sperre auf die Familie,
 * Versionsnummer = Maximum + 1, Vorgänger bleibt unverändert.
 */
export async function createNewVersionInTx(
  tx: Tx,
  predecessorId: string,
  input: ItemInput,
  origin?: ItemOrigin,
): Promise<string> {
  await assertValuesExist(tx, input);
  const [pred] = await tx<{ familyId: string; origin: ItemOrigin }[]>`
    select family_id as "familyId", origin from item where id = ${predecessorId}`;
  if (!pred) throw notFound('Die Frage');
  await tx`select id from item_family where id = ${pred.familyId} for update`;
  const [maxRow] = await tx<{ next: number }[]>`
    select coalesce(max(version_number), 0) + 1 as next from item where family_id = ${pred.familyId}`;
  const next = maxRow!.next;
  const [item] = await tx<{ id: string }[]>`
    insert into item (family_id, version_number, predecessor_id, text, item_type, perspective, status, origin)
    values (${pred.familyId}, ${next}, ${predecessorId}, ${input.text}, ${input.itemType}, ${input.perspective},
            'ZUR_PRUEFUNG', ${origin ?? pred.origin})
    returning id`;
  await insertAssignments(tx, item!.id, input);
  return item!.id;
}

/**
 * Bearbeiten (5.11, 5.15, 5.18, 5.21): nicht verwendet → in place und Status „zur Prüfung";
 * verwendet → neue Version. Liefert die gespeicherte (ggf. neue) Version.
 */
export async function updateItem(
  sql: Sql,
  id: string,
  body: unknown,
): Promise<ItemDto & { newVersion: boolean }> {
  const input = itemInputSchema.parse(body);
  const result = await sql.begin(async (tx) => {
    const [current] = await tx<{ usedAt: Date | null }[]>`
      select used_at as "usedAt" from item where id = ${id} for update`;
    if (!current) throw notFound('Die Frage');
    if (current.usedAt !== null) {
      return { id: await createNewVersionInTx(tx, id, input), newVersion: true };
    }
    await assertValuesExist(tx, input);
    await tx`
      update item set text = ${input.text}, item_type = ${input.itemType}, perspective = ${input.perspective},
                      status = 'ZUR_PRUEFUNG'
      where id = ${id}`;
    await tx`delete from value_assignment where item_id = ${id}`;
    await insertAssignments(tx, id, input);
    // Ein nicht mehr freigegebenes Item darf nicht in Entwurfs-Pools bleiben (5.17).
    await tx`
      delete from campaign_pool_item p using campaign c
      where c.id = p.campaign_id and c.status = 'ENTWURF' and p.item_id = ${id}`;
    return { id, newVersion: false };
  });
  return { ...(await getItem(sql, result.id)), newVersion: result.newVersion };
}

/** Freigabe (5.13, 5.14, 5.25): nur aus „zur Prüfung" oder „deaktiviert", Regeln erneut prüfen. */
/** Liefert die verletzte Gültigkeitsregel (5.1–5.9) oder `null`, wenn die Frage freigegeben werden darf. */
function approvalViolation(item: ItemDto): string | null {
  const check = itemInputSchema.safeParse({
    text: item.text,
    itemType: item.itemType,
    perspective: item.perspective,
    assignments: item.assignments.map((a) => ({ valueId: a.valueId, weight: a.weight })),
  });
  if (check.success) return null;
  return check.error.issues[0]?.message ?? 'Die Frage erfüllt die Gültigkeitsregeln nicht.';
}

export async function approveItem(sql: Sql, id: string): Promise<ItemDto> {
  const item = await getItem(sql, id);
  if (item.status === 'FREIGEGEBEN') {
    throw new AppError(409, 'ALREADY_APPROVED', 'Die Frage ist bereits freigegeben.');
  }
  const violation = approvalViolation(item);
  if (violation) {
    throw new AppError(422, 'RULE_VIOLATED', `Freigabe nicht möglich: ${violation}`);
  }
  await sql`update item set status = 'FREIGEGEBEN' where id = ${id}`;
  return getItem(sql, id);
}

export const bulkApproveSchema = z.object({
  ids: z
    .array(z.uuid('Ungültige Frage.'))
    .min(1, 'Bitte mindestens eine Frage auswählen.')
    .max(1000, 'Es können höchstens 1.000 Fragen auf einmal freigegeben werden.'),
});

export interface BulkApproveResult {
  approved: string[];
  skipped: { id: string; reason: string }[];
}

/**
 * Sammelfreigabe: wendet auf jede Frage dieselben Regeln an wie die Einzelfreigabe (5.13, 5.14).
 * Gültige Fragen werden in einer Transaktion freigegeben; bereits freigegebene, unbekannte oder
 * ungültige Fragen werden mit Grund übersprungen.
 */
export async function bulkApproveItems(sql: Sql, body: unknown): Promise<BulkApproveResult> {
  const { ids } = bulkApproveSchema.parse(body);
  const unique = [...new Set(ids)];
  return sql.begin(async (tx) => {
    // Sperre verhindert, dass parallel bearbeitete Fragen ungeprüft freigegeben werden.
    await tx`select id from item where id = any(${unique}::uuid[]) for update`;
    const items = await loadItems(tx, unique);
    const byId = new Map(items.map((i) => [i.id, i]));
    const approved: string[] = [];
    const skipped: BulkApproveResult['skipped'] = [];
    for (const id of unique) {
      const item = byId.get(id);
      if (!item) skipped.push({ id, reason: 'Die Frage wurde nicht gefunden.' });
      else if (item.status === 'FREIGEGEBEN')
        skipped.push({ id, reason: 'Die Frage ist bereits freigegeben.' });
      else {
        const violation = approvalViolation(item);
        if (violation) skipped.push({ id, reason: violation });
        else approved.push(id);
      }
    }
    if (approved.length > 0) {
      await tx`update item set status = 'FREIGEGEBEN' where id = any(${approved}::uuid[])`;
    }
    return { approved, skipped };
  });
}

/** Deaktivieren außerhalb einer laufenden Kampagne (5.16): nur der Status ändert sich. */
export async function deactivateItem(sql: Sql, id: string): Promise<ItemDto> {
  const item = await getItem(sql, id);
  if (item.status !== 'FREIGEGEBEN') {
    throw new AppError(409, 'NOT_APPROVED', 'Nur freigegebene Fragen können deaktiviert werden.');
  }
  await sql.begin(async (tx) => {
    await tx`update item set status = 'DEAKTIVIERT' where id = ${id}`;
    await tx`
      delete from campaign_pool_item p using campaign c
      where c.id = p.campaign_id and c.status = 'ENTWURF' and p.item_id = ${id}`;
  });
  return getItem(sql, id);
}

/** Löschen (5.26, 5.27): nur nicht verwendete Versionen; leere Familie wird mitgelöscht. */
export async function deleteItem(sql: Sql, id: string): Promise<void> {
  await sql.begin(async (tx) => {
    const [item] = await tx<{ usedAt: Date | null; familyId: string }[]>`
      select used_at as "usedAt", family_id as "familyId" from item where id = ${id} for update`;
    if (!item) throw notFound('Die Frage');
    if (item.usedAt !== null) {
      throw new AppError(
        409,
        'USED_ITEM_NOT_DELETABLE',
        'Diese Version der Frage wurde in einer Kampagne verwendet und kann nicht gelöscht werden.',
      );
    }
    await tx`delete from item where id = ${id}`;
    await tx`delete from item_family f where f.id = ${item.familyId}
             and not exists (select 1 from item where family_id = f.id)`;
  });
}

/** Versionshistorie einer Familie (5.24). */
export async function listFamilyVersions(sql: Sql, familyId: string) {
  return sql<
    {
      itemId: string;
      versionNumber: number;
      status: ItemStatus;
      used: boolean;
      predecessorId: string | null;
    }[]
  >`
    select id as "itemId", version_number as "versionNumber", status, used_at is not null as used,
           predecessor_id as "predecessorId"
    from item where family_id = ${familyId} order by version_number`;
}

export function itemsRouter(sql: () => Sql): Router {
  const r = Router();
  r.get('/items', async (req, res) => {
    const valueId = typeof req.query.valueId === 'string' ? req.query.valueId : undefined;
    const status = ITEM_STATUSES.find((s) => s === req.query.status);
    res.json(await listItems(sql(), { valueId, status }));
  });
  r.post('/items', async (req, res) => {
    res.status(201).json(await createItem(sql(), req.body));
  });
  r.get('/items/:id', async (req, res) => {
    res.json(await getItem(sql(), req.params.id));
  });
  r.put('/items/:id', async (req, res) => {
    res.json(await updateItem(sql(), req.params.id, req.body));
  });
  r.delete('/items/:id', async (req, res) => {
    await deleteItem(sql(), req.params.id);
    res.status(204).end();
  });
  r.post('/items/bulk-approve', async (req, res) => {
    res.json(await bulkApproveItems(sql(), req.body));
  });
  r.post('/items/:id/approve', async (req, res) => {
    res.json(await approveItem(sql(), req.params.id));
  });
  r.post('/items/:id/deactivate', async (req, res) => {
    res.json(await deactivateItem(sql(), req.params.id));
  });
  r.get('/item-families/:id/versions', async (req, res) => {
    res.json(await listFamilyVersions(sql(), req.params.id));
  });
  return r;
}
