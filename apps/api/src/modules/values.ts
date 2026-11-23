/** Unternehmenswerte und Fokussätze (Anforderung 2). */
import { focusSentenceInputSchema, valueInputSchema } from '@kb/shared';
import { Router } from 'express';
import type { Sql, Tx } from '../db/client.js';
import { AppError, notFound } from '../http/errors.js';

export interface FocusSentenceDto {
  id: string;
  text: string;
  position: number;
}

export interface ValueDto {
  id: string;
  name: string;
  description: string;
  focusSentences: FocusSentenceDto[];
}

export async function listValues(sql: Sql | Tx): Promise<ValueDto[]> {
  const values = await sql<{ id: string; name: string; description: string }[]>`
    select id, name, description from value order by name`;
  const sentences = await sql<(FocusSentenceDto & { valueId: string })[]>`
    select id, value_id as "valueId", text, position from focus_sentence order by position, created_at`;
  return values.map((v) => ({
    ...v,
    focusSentences: sentences
      .filter((s) => s.valueId === v.id)
      .map(({ id, text, position }) => ({ id, text, position })),
  }));
}

async function getValue(sql: Sql | Tx, id: string): Promise<ValueDto> {
  const value = (await listValues(sql)).find((v) => v.id === id);
  if (!value) throw notFound('Der Unternehmenswert');
  return value;
}

function duplicateName(err: unknown): AppError | null {
  const e = err as { code?: string; constraint_name?: string };
  if (e.code === '23505' && e.constraint_name === 'value_name_unique') {
    return new AppError(409, 'DUPLICATE_NAME', 'Dieser Name ist bereits vergeben.', {
      name: ['Dieser Name ist bereits vergeben.'],
    });
  }
  return null;
}

export async function createValue(sql: Sql, input: unknown): Promise<ValueDto> {
  const { name, description } = valueInputSchema.parse(input);
  try {
    const [row] = await sql<{ id: string }[]>`
      insert into value (name, description) values (${name}, ${description}) returning id`;
    return getValue(sql, row!.id);
  } catch (err) {
    throw duplicateName(err) ?? err;
  }
}

/** Bearbeiten ist auch bei Referenz durch verwendete Item-Versionen erlaubt (2.7). */
export async function updateValue(sql: Sql, id: string, input: unknown): Promise<ValueDto> {
  const { name, description } = valueInputSchema.parse(input);
  try {
    const rows =
      await sql`update value set name = ${name}, description = ${description} where id = ${id} returning id`;
    if (rows.length === 0) throw notFound('Der Unternehmenswert');
    return getValue(sql, id);
  } catch (err) {
    throw duplicateName(err) ?? err;
  }
}

/**
 * Löschen (2.8–2.10, 2.13): abgelehnt, wenn eine verwendete Item-Version den Wert referenziert
 * (das schließt aktive Kampagnen ein). Zuordnungen nicht verwendeter Versionen werden entfernt;
 * verliert eine Version dadurch ihre letzte Zuordnung > 0 %, geht sie auf „zur Prüfung" und
 * fällt aus den Entwurfs-Pools.
 */
export async function deleteValue(sql: Sql, id: string): Promise<void> {
  await sql.begin(async (tx) => {
    const [value] = await tx`select id from value where id = ${id} for update`;
    if (!value) throw notFound('Der Unternehmenswert');

    const [used] = await tx`
      select 1 from value_assignment va join item i on i.id = va.item_id
      where va.value_id = ${id} and i.used_at is not null limit 1`;
    if (used) {
      throw new AppError(
        409,
        'VALUE_REFERENCED_BY_USED_ITEM',
        'Der Unternehmenswert wird von Item-Versionen referenziert, die in einer Kampagne verwendet wurden, und kann nicht gelöscht werden.',
      );
    }

    const affected = await tx<{ itemId: string }[]>`
      delete from value_assignment where value_id = ${id} returning item_id as "itemId"`;
    const itemIds = affected.map((a) => a.itemId);
    if (itemIds.length > 0) {
      const orphaned = await tx<{ id: string }[]>`
        update item set status = 'ZUR_PRUEFUNG'
        where id = any(${itemIds}::uuid[])
          and not exists (select 1 from value_assignment va where va.item_id = item.id and va.weight > 0)
        returning id`;
      if (orphaned.length > 0) {
        await tx`
          delete from campaign_pool_item p using campaign c
          where c.id = p.campaign_id and c.status = 'ENTWURF'
            and p.item_id = any(${orphaned.map((o) => o.id)}::uuid[])`;
      }
    }
    await tx`delete from value where id = ${id}`;
  });
}

export async function addFocusSentence(
  sql: Sql,
  valueId: string,
  input: unknown,
): Promise<ValueDto> {
  const { text } = focusSentenceInputSchema.parse(input);
  const [exists] = await sql`select 1 from value where id = ${valueId}`;
  if (!exists) throw notFound('Der Unternehmenswert');
  await sql`
    insert into focus_sentence (value_id, text, position)
    values (${valueId}, ${text}, (select coalesce(max(position), 0) + 1 from focus_sentence where value_id = ${valueId}))`;
  return getValue(sql, valueId);
}

export async function updateFocusSentence(sql: Sql, id: string, input: unknown): Promise<ValueDto> {
  const { text } = focusSentenceInputSchema.parse(input);
  const [row] = await sql<{ valueId: string }[]>`
    update focus_sentence set text = ${text} where id = ${id} returning value_id as "valueId"`;
  if (!row) throw notFound('Der Fokussatz');
  return getValue(sql, row.valueId);
}

export async function removeFocusSentence(sql: Sql, id: string): Promise<ValueDto> {
  const [row] = await sql<{ valueId: string }[]>`
    delete from focus_sentence where id = ${id} returning value_id as "valueId"`;
  if (!row) throw notFound('Der Fokussatz');
  return getValue(sql, row.valueId);
}

export function valuesRouter(sql: () => Sql): Router {
  const r = Router();
  r.get('/values', async (_req, res) => {
    res.json(await listValues(sql()));
  });
  r.post('/values', async (req, res) => {
    res.status(201).json(await createValue(sql(), req.body));
  });
  r.put('/values/:id', async (req, res) => {
    res.json(await updateValue(sql(), req.params.id, req.body));
  });
  r.delete('/values/:id', async (req, res) => {
    await deleteValue(sql(), req.params.id);
    res.status(204).end();
  });
  r.post('/values/:id/focus-sentences', async (req, res) => {
    res.status(201).json(await addFocusSentence(sql(), req.params.id, req.body));
  });
  r.put('/focus-sentences/:id', async (req, res) => {
    res.json(await updateFocusSentence(sql(), req.params.id, req.body));
  });
  r.delete('/focus-sentences/:id', async (req, res) => {
    res.json(await removeFocusSentence(sql(), req.params.id));
  });
  return r;
}
