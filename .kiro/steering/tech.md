# Techstack

Dieses Dokument legt den verbindlichen Techstack des Kulturbarometers fest. Spezifikation (Design, Tasks) und Implementierung richten sich danach.

## Frontend

- **Framework:** React 19
- **Sprache:** TypeScript
- **Build-Tool:** Vite
- **Routing:** React Router
- **Server-State:** TanStack Query
- **Diagramme:** Recharts

## Backend

- **Laufzeitumgebung:** Node.js
- **Webserver:** Express.js
- **Sprache:** TypeScript (gemeinsame Typen mit dem Frontend)

## Datenbank

- **Datenbank-Anbindung:** Supabase (PostgreSQL), Projekt `kulturbarometer` (Region eu-west-1)
- **Zugriff aus dem Backend:** direkte Postgres-Verbindung mit `postgres` (postgres.js) für alle Abläufe, damit Transaktionen und Zeilensperren möglich sind. Auf Vercel über den Supabase-Connection-Pooler im Transaktionsmodus (Port 6543, `prepare: false`).
- **Schema-Änderungen:** als SQL-Migrationen im Verzeichnis `supabase/migrations`.
- **Row Level Security:** auf allen Tabellen aktiviert, ohne Policies für `anon`/`authenticated`. Das Frontend greift nie direkt auf Tabellen zu; nur das Backend liest und schreibt.

## Querschnitt

- **Authentifizierung der Administratoren:** Supabase Auth (E-Mail und Passwort). Das Frontend meldet sich über supabase-js an; das Backend prüft das Zugriffstoken in der Middleware `AuthGuard`. Sperre nach Fehlversuchen und Inaktivitäts-Timeout (Anforderung 1.3, 1.6) werden nach dem Prototyp im Backend ergänzt.
- **Validierung:** Zod (geteilte Schemata in `packages/shared`)
- **Tests:** Vitest und fast-check (Property-Based Testing)
- **LLM-Anbindung:** hinter dem Port `ItemGenerationPort`; im Prototyp ein Mock-Adapter, ein echter Adapter sobald ein API-Zugang vorliegt
- **E-Mail-Versand:** hinter dem Port `MailPort`; nicht Teil des Prototyps

## Repository-Struktur

npm-Workspaces in einem Repository:

- `apps/web` – React-Frontend (Admin- und Teilnahmebereich)
- `apps/api` – Express-Backend
- `packages/shared` – gemeinsame Typen, Zod-Schemata und reine Fachlogik (z. B. Ist-Score, Verteilung)
- `supabase/migrations` – Datenbankschema

## Hosting

- **Vercel:** ein Projekt; das Frontend als statischer Build, das Express-Backend als Vercel Function unter `/api`.
- **Konfiguration:** Zugangsdaten (Datenbank-Verbindung, Supabase-Keys) ausschließlich als Umgebungsvariablen in Vercel bzw. lokal in einer nicht eingecheckten `.env`.
