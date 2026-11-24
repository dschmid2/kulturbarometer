# Wertebarometer

Webapplikation zur Untersuchung der gelebten Unternehmenswerte: Unternehmenswerte, Umfrage-Items aus drei Perspektiven (Selbst, Team, Führung), Kampagnen mit anonymer Teilnahme und Auswertung mit Verteilung und Perspektivvergleich.

Spezifikation: `.kiro/specs/wertebarometer/` (Anforderungen, Design, Umsetzungsplan) und `.kiro/steering/tech.md` (Techstack).

## Aufbau

| Verzeichnis | Inhalt |
| --- | --- |
| `apps/web` | React-19-Frontend (Vite) für Administration (`/admin`) und Teilnahme (`/umfrage/:link`) |
| `apps/api` | Express-Backend; auf Vercel als Function unter `/api` (`api/index.ts`) |
| `packages/shared` | Gemeinsame Typen, Zod-Schemata und Fachlogik (Ist-Score, Verteilung, Anonymitätsschwelle) |
| `db/migrations` | Datenbankschema als SQL-Migrationen (reines PostgreSQL) |

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

## Unternehmungen, Benutzer und Rollen

Das Wertebarometer ist mandantenfähig. Werte, Fragen und Kampagnen gehören jeweils einer **Unternehmung**; jede Unternehmung sieht nur ihre eigenen Daten. Benutzer melden sich über Supabase Auth an und haben je Unternehmung eine oder mehrere Rollen:

| Rolle | Darf |
| --- | --- |
| **Benutzer-Administration** | Benutzer der Unternehmung zuordnen, Rollen vergeben und entfernen |
| **Werte-Administration** | Unternehmenswerte, Fokussätze und Fragen verwalten und freigeben |
| **Kampagnen-Administration** | Kampagnen durchführen und Auswertungen einsehen; Werte und Fragen lesen |

Darüber steht der **Plattform-Administrator**: Er legt Unternehmungen an, benennt sie um und hat in jeder Unternehmung alle Rollen. Ein Benutzer kann mehreren Unternehmungen zugeordnet sein und wählt die aktive Unternehmung oben rechts.

### Ersten Plattform-Administrator einrichten

1. Beim Anmeldedienst ein Konto anlegen (Supabase: Dashboard → Authentication → Users → „Add user“, E-Mail und Passwort).
2. Plattform-Admin-Recht in der eigenen Datenbank setzen (SQL-Editor des Datenbank-Anbieters):

   ```sql
   insert into platform_admin (user_id, email)
   select id::text, email from auth.users where email = 'admin@example.org';  -- Supabase
   ```

   Bei anderen Anmeldediensten die Benutzer-ID direkt eintragen (siehe „Datenbank und Anbieterwechsel“).

3. Im Wertebarometer unter **Unternehmungen** die erste Unternehmung anlegen und unter **Benutzer** weitere Personen mit ihren Rollen zuordnen.
4. Empfohlen: unter Authentication → Sign In / Providers die Selbstregistrierung („Allow new users to sign up") ausschalten. Neue Personen kommen dann nur über eine Einladung oder das Supabase-Dashboard dazu.

### Benutzer hinzufügen

Unter **Benutzer** ordnet eine Person mit der Rolle Benutzer-Administration andere per E-Mail-Adresse zu. Gibt es zu der Adresse schon ein Konto, wird es direkt zugeordnet. Andernfalls verschickt das Wertebarometer eine Einladung per E-Mail, sofern `SUPABASE_SECRET_KEY` gesetzt ist; ohne diesen Schlüssel muss das Konto zuerst im Supabase-Dashboard angelegt werden. Mindestens eine Person pro Unternehmung behält immer die Rolle Benutzer-Administration.

Eingeladene Personen landen nach dem Klick auf den Einladungslink direkt bei **Passwort festlegen**. Angemeldete Benutzer ändern ihr Passwort im Benutzermenü unter **Passwort ändern**; dabei wird das aktuelle Passwort bestätigt und andere angemeldete Geräte werden abgemeldet. Die Mindestlänge in Supabase (Authentication → Providers → Email → Minimum password length) sollte höchstens 8 betragen, damit sie zur Prüfung in der Oberfläche passt.

## Umgebungsvariablen

| Variable | Verwendung |
| --- | --- |
| `DATABASE_URL` | Postgres-Verbindung des Backends, bei jedem Anbieter. Auf Vercel ein Verbindungs-Pooler im Transaktionsmodus (z. B. Supabase Port 6543 oder Neon „pooled connection“). **Geheim**, nur in Vercel bzw. lokal in `.env`. |
| `AUTH_PROVIDER`, `VITE_AUTH_PROVIDER` | Anmeldedienst im Backend bzw. Frontend; derzeit `supabase` (Standard). |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Nur mit `AUTH_PROVIDER=supabase`: Prüfung der Zugriffstokens im Backend |
| `SUPABASE_SECRET_KEY` | Nur mit `AUTH_PROVIDER=supabase`, optional: Einladungen neuer Benutzer per E-Mail. **Geheim**, nur im Backend (Vercel bzw. `.env`). |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Nur mit `VITE_AUTH_PROVIDER=supabase`: Anmeldung im Frontend |

## Deployment

Das Vercel-Projekt `wertebarometer` ist mit diesem Repository verbunden; Produktion unter https://wertebarometer.vercel.app (die frühere Adresse https://kulturbarometer.vercel.app bleibt erreichbar). Jeder Push erzeugt ein Deployment; `main` ist die Produktion, andere Branches erzeugen Vorschau-Deployments. Build-Einstellungen stehen in `vercel.json`.

## Datenbank und Anbieterwechsel

Die Anwendung ist nicht an einen Postgres-Anbieter gebunden:

- **Schema:** Migrationen sind reines PostgreSQL in `db/migrations` (Dateiname `JJJJMMTTHHMMSS_name.sql`). Der eigene Runner führt fehlende Migrationen aus und vermerkt sie in `schema_migrations`:

  ```bash
  DATABASE_URL=… npm run db:migrate
  ```

  Für eine Datenbank, deren Schema schon besteht, markiert `npm run db:migrate -- --baseline <version>` die Migrationen bis zu dieser Version nur als angewendet.
- **Datenzugriff:** ausschliesslich über `DATABASE_URL` (postgres.js, `prepare: false`, damit auch Pooler im Transaktionsmodus funktionieren). Für Migrationen besser eine direkte, nicht gepoolte Verbindung verwenden.
- **Anmeldung:** hinter einer Schnittstelle – im Backend `apps/api/src/auth/provider.ts`, im Frontend `apps/web/src/lib/auth/`. Supabase-spezifischer Code steht nur in `auth/providers/supabase.ts` bzw. `lib/auth/supabase.ts`. Ein weiterer Anbieter wird ergänzt, indem er diese Schnittstellen umsetzt und unter `AUTH_PROVIDER`/`VITE_AUTH_PROVIDER` eingetragen wird.
- **Berechtigungen:** Plattform-Administratoren (`platform_admin`), Mitgliedschaften und Rollen liegen in der eigenen Datenbank; Benutzer-IDs werden als Text gespeichert, weil Anmeldedienste unterschiedliche ID-Formate verwenden.

Einen Plattform-Administrator ernennen (direkt in der Datenbank):

```sql
insert into platform_admin (user_id, email) values ('<Benutzer-ID>', '<E-Mail>');
```
