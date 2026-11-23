import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

let instance: Sql | undefined;

/**
 * Lazily erzeugte Verbindung. Auf Vercel über den Supabase-Pooler im Transaktionsmodus;
 * dieser unterstützt keine Prepared Statements, daher `prepare: false`.
 */
export function db(): Sql {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL ist nicht gesetzt.');
    instance = postgres(url, {
      prepare: false,
      max: process.env.VERCEL ? 1 : 10,
      idle_timeout: 20,
      types: { numeric: { to: 1700, from: [1700], serialize: String, parse: Number } },
    });
  }
  return instance;
}

export async function closeDb(): Promise<void> {
  await instance?.end();
  instance = undefined;
}
