import { describe, expect, it } from 'vitest';
import { listMigrations, migrate } from '../src/db/migrate.js';
import { createEmptyTestDb, TEST_DATABASE_URL } from './db.js';

describe.skipIf(!TEST_DATABASE_URL)('Migrationsrunner (anbieterneutral)', () => {
  it('wendet alle Migrationen einmal an und ist danach idempotent', async () => {
    const sql = await createEmptyTestDb();
    try {
      const first = await migrate(sql);
      expect(first).toEqual(listMigrations().map((m) => m.name));
      expect(await migrate(sql)).toEqual([]);
      const rows = await sql`select version from schema_migrations order by version`;
      expect(rows.map((r) => r.version)).toEqual(listMigrations().map((m) => m.version));
      // Plattform-Administratoren liegen in der eigenen Datenbank
      const [t] = await sql`select to_regclass('platform_admin') as t`;
      expect(t!.t).toBe('platform_admin');
    } finally {
      await sql.end();
    }
  });

  it('markiert bei --baseline bestehende Migrationen nur, ohne sie auszuführen', async () => {
    const sql = await createEmptyTestDb();
    try {
      const all = listMigrations();
      const upTo = all[0]!.version;
      // Simuliert eine Datenbank, deren erste Migration schon (anders) eingespielt wurde.
      await sql.unsafe(await import('node:fs').then((fs) => fs.readFileSync(all[0]!.path, 'utf8')));
      const done = await migrate(sql, { baselineUpTo: upTo });
      expect(done).toEqual(all.map((m) => m.name));
      expect(await migrate(sql)).toEqual([]);
    } finally {
      await sql.end();
    }
  });
});
