/**
 * Anbieterneutraler Migrationsrunner (reines PostgreSQL, funktioniert mit Supabase, Neon,
 * RDS, lokalem Postgres …).
 *
 * - Migrationen sind SQL-Dateien in `db/migrations`, sortiert nach ihrem Namen; die Version ist
 *   der Teil vor dem ersten Unterstrich (z. B. `20261124120000`).
 * - Angewendete Versionen stehen in `schema_migrations`.
 * - Jede Migration läuft in einer eigenen Transaktion mit transaktionsgebundenem Advisory-Lock.
 *   Das funktioniert auch über Verbindungs-Pooler im Transaktionsmodus (PgBouncer, Neon-Pooler).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './client.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../db/migrations/', import.meta.url));

/** Beliebige, feste Zahl für den Advisory-Lock der Migrationen. */
const LOCK_KEY = 7242026;

export interface MigrationFile {
  version: string;
  name: string;
  path: string;
}

export function listMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ version: f.split('_')[0]!, name: f, path: join(dir, f) }));
}

async function ensureTable(sql: Sql): Promise<void> {
  await sql.unsafe(`
    create table if not exists schema_migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
    -- Kein Zugriff über automatisch erzeugte APIs (z. B. Supabase PostgREST, Neon Data API).
    alter table schema_migrations enable row level security`);
}

export interface MigrateOptions {
  dir?: string;
  /** Nur als angewendet markieren (für Datenbanken, deren Schema schon besteht), bis inkl. dieser Version. */
  baselineUpTo?: string;
  log?: (message: string) => void;
}

/** Wendet alle noch fehlenden Migrationen an und liefert die Namen der neu angewendeten. */
export async function migrate(sql: Sql, options: MigrateOptions = {}): Promise<string[]> {
  const log = options.log ?? (() => {});
  await ensureTable(sql);
  const applied: string[] = [];
  for (const m of listMigrations(options.dir)) {
    const done = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
      const [row] = await tx`select 1 from schema_migrations where version = ${m.version}`;
      if (row) return false;
      const baseline = options.baselineUpTo !== undefined && m.version <= options.baselineUpTo;
      if (!baseline) await tx.unsafe(readFileSync(m.path, 'utf8'));
      await tx`insert into schema_migrations (version, name) values (${m.version}, ${m.name})`;
      log(`${baseline ? 'markiert' : 'angewendet'}: ${m.name}`);
      return true;
    });
    if (done) applied.push(m.name);
  }
  return applied;
}
