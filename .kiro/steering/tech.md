# Techstack

Dieses Dokument legt den verbindlichen Techstack des Kulturbarometers fest. Spezifikation (Design, Tasks) und Implementierung richten sich danach.

## Frontend

- **Framework:** React 19
- **Sprache:** TypeScript
- **Build-Tool:** Vite

## Backend

- **Laufzeitumgebung:** Node.js
- **Webserver:** Express.js
- **Sprache:** TypeScript (gemeinsame Typen mit dem Frontend)

## Datenbank

- **Datenbank-Anbindung:** Supabase (PostgreSQL)

## Noch nicht festgelegt

Für die folgenden Bereiche gibt es keine Vorgabe. Bis zur Entscheidung gelten die Vorschläge aus dem Design als unverbindlich:

- Authentifizierung der Administratoren (z. B. Supabase Auth oder eigene Sessions)
- Zugriff auf Supabase aus dem Backend (z. B. supabase-js mit Service-Key, direkte Postgres-Verbindung)
- Validierung (Vorschlag: Zod)
- Tests (Vorschlag: Vitest und fast-check für Property-Based Testing)
- LLM-Anbindung und E-Mail-Versand (jeweils hinter austauschbaren Ports)
- Routing und Server-State im Frontend (Vorschlag: React Router, TanStack Query)
