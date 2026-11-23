import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import type { Sql } from '../src/db/client.js';

/**
 * Integrationstests laufen gegen eine echte Postgres-Datenbank, wenn TEST_DATABASE_URL gesetzt ist
 * (z. B. postgres://postgres@localhost:54329/kb_it). Die Datenbank wird neu angelegt und mit den
 * Migrationen aus supabase/migrations befüllt.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

export async function createTestDb(): Promise<Sql> {
  const url = new URL(TEST_DATABASE_URL!);
  const dbName = `${url.pathname.slice(1)}_${process.pid}_${Date.now()}`;
  const admin = postgres({ ...parse(url), database: 'postgres', onnotice: () => {} });
  await admin.unsafe(`create database "${dbName}"`);
  await admin.end();
  const sql = postgres({
    ...parse(url),
    database: dbName,
    onnotice: () => {},
    types: { numeric: { to: 1700, from: [1700], serialize: String, parse: Number } },
  }) as unknown as Sql;
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await sql.unsafe(readFileSync(MIGRATIONS + file, 'utf8'));
  }
  return sql;
}

function parse(url: URL) {
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    username: decodeURIComponent(url.username || 'postgres'),
    password: decodeURIComponent(url.password),
  };
}

export async function truncateAll(sql: Sql): Promise<void> {
  // Trigger blockieren Löschungen in Snapshot-Tabellen; für Tests werden sie kurz umgangen.
  await sql.unsafe(`
    set session_replication_role = replica;
    truncate answer_item, participation, survey_session, participant_marker, campaign_link,
             snapshot_assignment, snapshot_item, campaign_pool_item, campaign,
             value_assignment, item, item_family, focus_sentence, value,
             organization_member, organization cascade;
    set session_replication_role = origin;`);
}
