/**
 * Kommandozeile: `npm run db:migrate` (Verbindung aus DATABASE_URL, bevorzugt eine direkte,
 * nicht gepoolte Verbindung). Mit `--baseline <version>` werden bestehende Migrationen bis zu
 * dieser Version nur als angewendet markiert.
 */
import { closeDb, db } from './client.js';
import { migrate } from './migrate.js';

const i = process.argv.indexOf('--baseline');
const baselineUpTo = i >= 0 ? process.argv[i + 1] : undefined;

try {
  const applied = await migrate(db(), { baselineUpTo, log: (m) => console.log(m) });
  console.log(applied.length ? `${applied.length} Migration(en) erledigt.` : 'Schema ist aktuell.');
} finally {
  await closeDb();
}
