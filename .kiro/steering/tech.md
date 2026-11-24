# Techstack

Dieses Dokument legt den verbindlichen Techstack des Wertebarometers fest. Spezifikation (Design, Tasks) und Implementierung richten sich danach.

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

- **Datenbank:** PostgreSQL, **anbieterunabhängig**. Aktuell Supabase, Projekt `wertebarometer`, Ref `lxuwfwbrlfofafwscojq` (Region eu-west-1); geplant ist der Wechsel zu Neon (Projekt `wertebarometer`, ID `steep-cherry-36391552`, AWS Frankfurt `aws-eu-central-1`, Postgres 18, Branch `production`, Neon Auth mit Better Auth; Schema bereits eingespielt). **Das Supabase-Projekt wird mit dem eigenständigen Projekt „stimmung“ geteilt** (Schema `stimmung`, gemeinsame Konten in Supabase Auth): Dessen Schema, Tabellen und Konten werden vom Wertebarometer nie verändert; das Wertebarometer nutzt ausschliesslich das Schema `public`. Das Supabase-Projekt wird auch nach dem Wechsel nicht gelöscht. Code und Migrationen dürfen keine anbieterspezifischen Funktionen voraussetzen (keine Supabase-Schemas wie `auth`, keine Data-API, keine Erweiterungen ausser Standard-PostgreSQL).
- **Zugriff aus dem Backend:** direkte Postgres-Verbindung mit `postgres` (postgres.js) über `DATABASE_URL` für alle Abläufe, damit Transaktionen und Zeilensperren möglich sind. Auf Vercel über einen Connection-Pooler im Transaktionsmodus (`prepare: false`).
- **Schema-Änderungen:** als SQL-Migrationen im Verzeichnis `db/migrations`, angewendet mit dem eigenen Runner (`npm run db:migrate`, Tabelle `schema_migrations`).
- **Row Level Security:** auf allen Tabellen aktiviert, ohne Policies. Das Frontend greift nie direkt auf Tabellen zu; nur das Backend liest und schreibt. So bleiben die Tabellen auch bei Anbietern mit automatisch erzeugten APIs (Supabase PostgREST, Neon Data API) geschützt.

## Querschnitt

- **Authentifizierung:** E-Mail und Passwort über einen austauschbaren Anmeldedienst (aktuell Supabase Auth, geplant Neon Auth/Better Auth). Backend: Schnittstelle `AuthProvider` (`apps/api/src/auth/provider.ts`, Auswahl über `AUTH_PROVIDER`), die das Zugriffstoken in `AuthGuard` prüft und Konten nachschlägt bzw. einlädt. Frontend: Schnittstelle `AuthClient` (`apps/web/src/lib/auth/`, Auswahl über `VITE_AUTH_PROVIDER`). Anbieterspezifischer Code steht nur in den jeweiligen Umsetzungen. Umsetzungen: `supabase` und `neon` (Neon Auth über den eigenen Proxy `/api/auth`, JWT-Prüfung mit `jose` gegen den JWKS-Endpunkt). Sperre nach Fehlversuchen und Inaktivitäts-Timeout (Anforderung 1.3, 1.6) werden nach dem Prototyp im Backend ergänzt.
- **Mandanten und Rollen:** Daten gehören einer Unternehmung; Rollen (`ADMIN`, `WERTE`, `KAMPAGNEN`) stehen je Unternehmung in `organization_member`. Die aktive Unternehmung kommt im Header `X-Organization-Id`. Plattform-Administratoren stehen in der Tabelle `platform_admin` der eigenen Datenbank (nicht beim Anmeldedienst). Benutzer-IDs werden als Text gespeichert. Einladungen neuer Konten laufen über den Anmeldedienst (bei Supabase die Admin-API mit `SUPABASE_SECRET_KEY`, optional, nur im Backend).
- **Validierung:** Zod (geteilte Schemata in `packages/shared`)
- **Tests:** Vitest und fast-check (Property-Based Testing)
- **LLM-Anbindung:** hinter dem Port `ItemGenerationPort`; im Prototyp ein Mock-Adapter, ein echter Adapter sobald ein API-Zugang vorliegt
- **E-Mail-Versand:** hinter dem Port `MailPort`; nicht Teil des Prototyps

## Repository-Struktur

npm-Workspaces in einem Repository:

- `apps/web` – React-Frontend (Admin- und Teilnahmebereich)
- `apps/api` – Express-Backend
- `packages/shared` – gemeinsame Typen, Zod-Schemata und reine Fachlogik (z. B. Ist-Score, Verteilung)
- `db/migrations` – Datenbankschema (reines PostgreSQL)

## Gestaltung

Der visuelle Auftritt folgt kulturarchitekt.ch (Werte aus dem WordPress-Theme Neve, Palette „Base", und dem Zusatz-CSS der Website). Alle Werte stehen als CSS-Variablen in `apps/web/src/styles.css`.

- **Farben:** Orange `#FF6A3D` (primärer Akzent, Buttons), Limette `#D4F53C` (sekundärer Akzent, Hover, aktive Navigation, Hervorhebungen), Dunkelviolett `#15142B` (Text, Kopfbereich, dunkle Flächen), Hellgrau `#F2F3F7` (Seitenhintergrund), Weiß (Karten); Zusatzfarben `#77B978` und `#F37262`
- **Schriften:** Space Grotesk für Überschriften und Wortmarke, Inter für Fließtext (Google Fonts)
- **Formen:** pillenförmige Buttons (Orange mit dunkler Schrift, Hover dunkel), Karten mit 18 px Radius und weichem Schatten, Eyebrow-Labels in Großbuchstaben mit orangem Quadrat, Bildzeichen aus Quadraten und Kreis
- **Begriffe in der Oberfläche:** Items heißen durchgängig „Fragen", auch wenn sie ein Szenario beschreiben. Die Item-Typen heißen „Aussage" (`FRAGE`) und „Szenario" (`SITUATION`). Spezifikation, Code und Datenbank verwenden weiterhin den Fachbegriff „Item".
- **Benutzermenü:** Avatar oben rechts mit Untermenü (Benutzer, Unternehmungen – je nach Berechtigung – und Abmelden). Das Profilbild kommt von Gravatar; übertragen wird nur der SHA-256-Hash der E-Mail-Adresse (`d=404`), ohne Gravatar-Bild erscheint der Anfangsbuchstabe. Nur im Administrationsbereich, nie in der Umfrage.
- **Perspektiven in Auswertungen:** Selbst Orange, Team Dunkelviolett, Führung Grün (`#77B978`)

## Hosting

- **Vercel:** ein Projekt; das Frontend als statischer Build, das Express-Backend als Vercel Function unter `/api`.
- **Konfiguration:** Zugangsdaten (Datenbank-Verbindung, Schlüssel des Anmeldedienstes) ausschließlich als Umgebungsvariablen in Vercel bzw. lokal in einer nicht eingecheckten `.env`.
