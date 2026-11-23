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

## Umgebungsvariablen

| Variable | Verwendung |
| --- | --- |
| `DATABASE_URL` | Postgres-Verbindung des Backends. Auf Vercel: Supabase Connection Pooler im Transaktionsmodus (Port 6543). **Geheim**, nur in Vercel bzw. lokal in `.env`. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Prüfung der Zugriffstokens der Administratoren im Backend |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Anmeldung der Administratoren im Frontend |

## Deployment

Das Vercel-Projekt `kulturbarometer` ist mit diesem Repository verbunden. Jeder Push erzeugt ein Deployment; `main` ist die Produktion, andere Branches erzeugen Vorschau-Deployments. Build-Einstellungen stehen in `vercel.json`.

Datenbankänderungen werden als neue Datei in `supabase/migrations` angelegt und auf das Supabase-Projekt angewendet.
