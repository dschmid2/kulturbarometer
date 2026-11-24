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

- **Datenbank-Anbindung:** Supabase (PostgreSQL), Projekt `wertebarometer`, Ref `lxuwfwbrlfofafwscojq` (Region eu-west-1)
- **Zugriff aus dem Backend:** direkte Postgres-Verbindung mit `postgres` (postgres.js) für alle Abläufe, damit Transaktionen und Zeilensperren möglich sind. Auf Vercel über den Supabase-Connection-Pooler im Transaktionsmodus (Port 6543, `prepare: false`).
- **Schema-Änderungen:** als SQL-Migrationen im Verzeichnis `supabase/migrations`.
- **Row Level Security:** auf allen Tabellen aktiviert, ohne Policies für `anon`/`authenticated`. Das Frontend greift nie direkt auf Tabellen zu; nur das Backend liest und schreibt.

## Querschnitt

- **Authentifizierung:** Supabase Auth (E-Mail und Passwort). Das Frontend meldet sich über supabase-js an; das Backend prüft das Zugriffstoken in der Middleware `AuthGuard`. Sperre nach Fehlversuchen und Inaktivitäts-Timeout (Anforderung 1.3, 1.6) werden nach dem Prototyp im Backend ergänzt.
- **Mandanten und Rollen:** Daten gehören einer Unternehmung; Rollen (`ADMIN`, `WERTE`, `KAMPAGNEN`) stehen je Unternehmung in `organization_member`. Die aktive Unternehmung kommt im Header `X-Organization-Id`. Plattform-Administratoren tragen `app_metadata.kb_role = 'admin'` (nur serverseitig setzbar). Einladungen neuer Konten laufen über die Supabase-Admin-API mit `SUPABASE_SECRET_KEY` (optional, nur im Backend).
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
- **Konfiguration:** Zugangsdaten (Datenbank-Verbindung, Supabase-Keys) ausschließlich als Umgebungsvariablen in Vercel bzw. lokal in einer nicht eingecheckten `.env`.
