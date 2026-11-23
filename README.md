# Kulturbarometer

Webapplikation zur Untersuchung der Unternehmenskultur: Unternehmenswerte, Umfrage-Items aus drei Perspektiven (Selbst, Team, Führung), Kampagnen mit anonymer Teilnahme und Auswertung mit Verteilung und Perspektivvergleich.

Spezifikation: `.kiro/specs/kulturbarometer/` (Anforderungen, Design, Umsetzungsplan) und `.kiro/steering/tech.md` (Techstack).

## Aufbau

| Verzeichnis | Inhalt |
| --- | --- |
| `apps/web` | React-19-Frontend (Vite) für Administration (`/admin`) und Teilnahme (`/umfrage/:link`) |
| `apps/api` | Express-Backend; auf Vercel als Function unter `/api` (`api/index.ts`) |
| `packages/shared` | Gemeinsame Typen, Zod-Schemata und Fachlogik (Ist-Score, Verteilung, Anonymitätsschwelle) |
| `supabase/migrations` | Datenbankschema als SQL-Migrationen |

## Lokale Entwicklung

Voraussetzung: Node.js 22.

```bash
npm install
cp .env.example .env   # Werte eintragen
npm run build -w @kb/shared
npm run dev:api        # http://localhost:3001
npm run dev:web        # http://localhost:5173, leitet /api an das Backend weiter
```

Tests und Typprüfung:

```bash
npm test
npm run typecheck
```

Die Integrationstests des Backends (`apps/api/test`) laufen gegen eine echte Postgres-Datenbank, wenn `TEST_DATABASE_URL` gesetzt ist; sie legen dafür jeweils eine eigene Testdatenbank mit allen Migrationen an. Ohne die Variable werden sie übersprungen.

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/kb_it npm test -w @kb/api
```

## Administratoren einrichten

Administratoren melden sich über Supabase Auth an. Zusätzlich braucht jedes Konto die Rolle `kb_role = 'admin'` in den App-Metadaten; ohne sie lehnt das Backend jeden Zugriff ab, auch mit gültiger Anmeldung.

1. Supabase-Dashboard → Authentication → Users → „Add user" (E-Mail und Passwort).
2. Rolle setzen (SQL-Editor im Supabase-Dashboard):

   ```sql
   update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"kb_role": "admin"}'
   where email = 'admin@example.org';
   ```

3. Empfohlen: unter Authentication → Sign In / Providers die Selbstregistrierung („Allow new users to sign up") ausschalten.

## Umgebungsvariablen

| Variable | Verwendung |
| --- | --- |
| `DATABASE_URL` | Postgres-Verbindung des Backends. Auf Vercel: Supabase Connection Pooler im Transaktionsmodus (Port 6543). **Geheim**, nur in Vercel bzw. lokal in `.env`. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Prüfung der Zugriffstokens der Administratoren im Backend |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Anmeldung der Administratoren im Frontend |

## Deployment

Das Vercel-Projekt `kulturbarometer` ist mit diesem Repository verbunden. Jeder Push erzeugt ein Deployment; `main` ist die Produktion, andere Branches erzeugen Vorschau-Deployments. Build-Einstellungen stehen in `vercel.json`.

Datenbankänderungen werden als neue Datei in `supabase/migrations` angelegt und auf das Supabase-Projekt angewendet.
