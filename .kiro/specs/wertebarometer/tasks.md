# Implementation Plan

Umsetzungsplan für den **ersten Prototyp** des Wertebarometers. Er baut den Kernablauf einmal durchgängig: Werte pflegen → Items erstellen und freigeben → Kampagne aktivieren → über den öffentlichen Link teilnehmen → Auswertung mit Verteilung und Perspektiven ansehen. Grundlage sind `requirements.md`, `design.md` und `.kiro/steering/tech.md`.

Aufgaben mit `*` sind Tests, die für den Prototyp empfohlen, aber nicht zwingend sind. Die Property-Nummern verweisen auf die Correctness Properties im Design. Was bewusst erst nach dem Prototyp kommt, steht am Ende.

- [x] 1. Projektgrundlage aufsetzen
  - [x] 1.1 Monorepo mit npm-Workspaces anlegen
    - Workspaces `apps/web`, `apps/api`, `packages/shared`; gemeinsame `tsconfig`, ESLint, Prettier
    - Vitest und fast-check in allen Workspaces; Skript `npm test` im Root
    - `.env.example` mit allen benötigten Variablen ohne Werte; `.env` in `.gitignore`
    - _Requirements: tech.md_
  - [x] 1.2 Frontend-Grundgerüst in `apps/web`
    - Vite + React 19 + TypeScript, React Router, TanStack Query
    - Getrennte Routenbereiche `/admin/*` und `/umfrage/*`
    - _Requirements: 1.4_
  - [x] 1.3 Backend-Grundgerüst in `apps/api`
    - Express-App mit zwei Routern (`/api/admin`, `/api/public`), zentrale Fehlerbehandlung mit fachlichen Fehlercodes
    - Datenbankzugriff über postgres.js mit Transaktions-Helfer; Konfiguration für Supabase-Pooler (`prepare: false`)
    - Einstiegspunkt für Vercel Function und lokaler Startbefehl
    - _Requirements: tech.md_
  - [x] 1.4 Vercel-Konfiguration
    - `vercel.json` mit statischem Build des Frontends und Rewrite von `/api/*` auf die Express-Function
    - _Requirements: tech.md_

- [x] 2. Datenbankschema anlegen
  - [x] 2.1 Migration für Werte und Items
    - Tabellen `value`, `focus_sentence`, `item_family`, `item`, `value_assignment` mit allen Feldern, Längen- und Bereichs-Constraints aus dem Datenmodell
    - `UNIQUE (family_id, version_number)`, `UNIQUE (item_id, value_id)`, Fremdschlüssel `value_assignment.value_id` mit `ON DELETE RESTRICT`
    - Trigger: bei `used_at IS NOT NULL` nur `status`/`updated_at` änderbar, keine Änderung der Zuordnungen, keine Löschung
    - _Requirements: 2.1, 2.4, 5.1, 5.6, 5.9, 5.12, 5.20, 5.27_
  - [x] 2.2 Migration für Kampagnen und Snapshot
    - Tabellen `campaign` (inkl. `items_per_participant`, `anonymity_threshold` 3–100 mit Vorgabe 5, `distribution_mode`), `campaign_pool_item`, `snapshot_item`, `snapshot_assignment`
    - Trigger: Snapshot nach Aktivierung unveränderlich, `deactivated_at` nur einmal von `NULL` auf einen Zeitpunkt
    - _Requirements: 6.1, 6.13, 6.14, 6.28_
  - [x] 2.3 Migration für Teilnahme und Antworten
    - Tabellen `campaign_link` (partieller Unique-Index für einen gültigen Link je Kampagne), `participant_marker`, `survey_session`, `participation` (`submitted_at` als Datum, `submission_seq`), `answer_item` (`rating NUMERIC(3,2)` 1,00–5,00, Kommentar bis 1.000 Zeichen)
    - Keine Verweise von `participation` auf Link, Kennung oder Session
    - _Requirements: 7.15, 7.19, 8.3, 8.9, 8.11_
  - [x] 2.4 Row Level Security auf allen Tabellen aktivieren, ohne Policies
    - _Requirements: tech.md, 8.9_

- [x] 3. Gemeinsame Fachlogik in `packages/shared`
  - [x] 3.1 Typen, Enums und Zod-Schemata
    - Wert, Fokussatz, Item (geteiltes Item-Schema für Verwaltung, Import und KI-Ausgabe), Kampagne, Bewertung
    - _Requirements: 2.1–2.5, 4.4, 5.1–5.9, 6.1–6.3, 6.28, 8.2–8.4_
  - [x] 3.2 Ist-Score und Vorfilter
    - `selectIncludedParticipations`, `selectScorableRatings`, `computeIstScore`, `countContributingParticipants`, `countExcludedRatings`, Rundung auf zwei Nachkommastellen
    - _Requirements: 9.1–9.7, 10.12_
  - [x]* 3.3 Property-Tests für den Ist-Score
    - Properties 1–8 und 21 (Feature: wertebarometer)
    - _Requirements: 9.1–9.5_
  - [x] 3.4 Verteilung und Perspektivdifferenzen
    - `computeParticipantScores`, `computeDistribution` (fünf Klassen, Median, Standardabweichung), `computePerspectiveGaps`
    - _Requirements: 9.8–9.10_
  - [x]* 3.5 Property-Tests für Verteilung und Differenzen
    - Properties 31 und 32
    - _Requirements: 9.8–9.10_
  - [x] 3.6 Anonymitätsschwelle
    - `applyAnonymityThreshold` für Auswertung und Export
    - _Requirements: 10.6, 10.13, 10.14_
  - [x]* 3.7 Property-Tests für Schwelle und Stufen der Zwischenauswertung
    - Properties 27 und 28
    - _Requirements: 10.6, 10.12–10.14_
  - [x] 3.8 Ziehung der Teilnehmer-Teilmenge mit injizierbarem Zufallsgenerator
    - `k = min(itemsPerParticipant, aktive Items)`, ohne Duplikate
    - _Requirements: 6.17, 6.19, 8.1_
  - [x]* 3.9 Property-Tests für die Ziehung
    - Properties 9, 10 und 20
    - _Requirements: 6.17, 8.1_

- [x] 4. Anmeldung der Administratoren
  - [x] 4.1 `AuthGuard`-Middleware: Supabase-Zugriffstoken prüfen, Admin-Routen ohne gültiges Token mit 401 abweisen
    - _Requirements: 1.1, 1.2, 1.4_
  - [x] 4.2 Login-Seite und Abmeldung im Frontend mit supabase-js; Weiterleitung auf die Anmeldeseite bei 401
    - _Requirements: 1.1, 1.2, 1.4, 1.5_
  - [x] 4.3 Ersten Administrator in Supabase Auth anlegen (dokumentierter Schritt im README)
    - _Requirements: 1.1_
  - [x] 4.4 Passwort ändern im Benutzermenü (aktuelles Passwort bestätigen, andere Sitzungen beenden) und Passwort festlegen nach Einladungs- oder Wiederherstellungslink
    - _Requirements: 1.7–1.9_

- [x] 5. Unternehmenswerte und Fokussätze
  - [x] 5.1 Admin-API: anlegen, bearbeiten, löschen (mit Löschschutz und Rücksetzung betroffener Items), auflisten; Fokussätze hinzufügen, bearbeiten, entfernen
    - _Requirements: 2.1–2.13_
  - [x] 5.2 Admin-Oberfläche: Liste mit Leerzustand, Formular mit Fehlermeldungen je Feld, Fokussätze verwalten
    - _Requirements: 2.1–2.12_
  - [x]* 5.3 Tests für Validierung, eindeutige Namen und Löschschutz
    - _Requirements: 2.2, 2.3, 2.5, 2.9, 2.10, 2.13_

- [x] 6. Items verwalten
  - [x] 6.1 Admin-API: anlegen, bearbeiten (in place bzw. neue Version über `createNewVersion`), löschen, freigeben, deaktivieren, Items je Wert auflisten
    - Versionsvergabe in einer Transaktion mit Sperre auf `item_family`
    - _Requirements: 5.1–5.23, 5.25–5.28_
  - [x] 6.2 Admin-Oberfläche: Item-Liste je Wert mit Status, Formular mit Perspektive, Typ und gewichteten Zuordnungen, Aktionen Freigeben/Deaktivieren/Löschen
    - _Requirements: 5.1–5.17, 5.28_
  - [x]* 6.3 Tests für Freigabe-Workflow und Versionierung
    - Property 25 sowie Beispieltests „Versionierung“ aus der Teststrategie
    - _Requirements: 5.13–5.15, 5.18–5.23, 5.25–5.27_

- [ ] 7. Item-Export und -Import
  - [ ] 7.1 Export: JSON mit allen Werten und dem aus Zod abgeleiteten JSON Schema
    - _Requirements: 4.1–4.3_
  - [ ] 7.2 Import: sicheres Parsen mit Größen- und Mengenlimit, Prüfung je Item, Auflösung der Wertnamen, Importbericht; gültige Items im Status „zur Prüfung“ in einer Transaktion
    - _Requirements: 4.4–4.9_
  - [ ] 7.3 Admin-Oberfläche: Export-Button, Datei-Upload, Anzeige des Importberichts
    - _Requirements: 4.1, 4.9_
  - [ ]* 7.4 Property-Tests für den Round-Trip und ungültige Items
    - Properties 23 und 24
    - _Requirements: 4.1–4.9_

- [ ] 8. KI-gestützte Item-Generierung
  - [ ] 8.1 `ItemGenerationPort` und Mock-Adapter (deterministische, ungültige und fehlerhafte Antworten)
    - _Requirements: 3.1–3.5, 3.12_
  - [ ] 8.2 Admin-API und -Oberfläche: Generierung je Wert auslösen, Vorschläge prüfen; Ausgabe gegen das geteilte Item-Schema validieren, bei Fehlern nichts speichern
    - _Requirements: 3.1–3.12_
  - [ ] 8.3 Echter LLM-Adapter, sobald ein API-Zugang vorliegt
    - _Requirements: 3.1, 3.3_

- [x] 9. Kampagnen
  - [x] 9.1 Admin-API: anlegen, Pool zuordnen (nur freigegebene Items), Item-Anzahl je Teilnehmer und Anonymitätsschwelle setzen, abgeleitete Werte anzeigen
    - _Requirements: 6.1–6.6, 6.28, 6.29_
  - [x] 9.2 Aktivierung in einer Transaktion: Prüfungen, Snapshot erzeugen, `used_at` setzen; Abschließen; Statusmaschine
    - _Requirements: 6.9–6.14, 6.25–6.27, 6.30_
  - [x] 9.3 Admin-Oberfläche: Kampagnenliste, Entwurf bearbeiten, Pool auswählen, aktivieren, abschließen
    - _Requirements: 6.1–6.12, 6.25_
  - [x]* 9.4 Property-Tests für Statusübergänge, Pool und Snapshot
    - Properties 12, 17 und 19
    - _Requirements: 6.4, 6.5, 6.11–6.14, 6.26_

- [ ] 10. Öffentlicher Kampagnen-Link
  - [ ] 10.1 Admin-API und -Oberfläche: Link erzeugen und ersetzen, Link anzeigen und kopieren
    - _Requirements: 7.1, 7.2, 7.15, 7.16_
  - [ ] 10.2 Teilnahmekennung: Code im Local Storage plus Cookie, serverseitig nur als Hash je Kampagne
    - _Requirements: 7.3, 7.4, 7.6, 7.14, 7.17_
  - [ ]* 10.3 Property-Test für den Link
    - Property 30
    - _Requirements: 7.15–7.17_

- [ ] 11. Umfrage beantworten
  - [ ] 11.1 Public-API `openSurvey`: Link und Status prüfen, bestehende Session wiederverwenden oder Teilmenge ziehen, Hinweise „nicht verfügbar“, „ungültiger Link“, „bereits teilgenommen“
    - _Requirements: 7.3, 7.4, 7.11–7.13, 8.1, 8.11, 8.12_
  - [ ] 11.2 Public-API `submitAnswer` in einer Transaktion: Prüfungen, Antwort ohne Verweise speichern, Kennung als teilgenommen markieren, Session löschen
    - _Requirements: 6.27, 8.2–8.10, 8.14, 7.19_
  - [ ] 11.3 Teilnahme-Oberfläche: Item-Text mit Perspektive als Kontext, stufenloser Schieberegler ohne Startwert mit Tastaturbedienung, optionaler Kommentar, Zwischenstand im Local Storage, Bestätigung
    - Skalenbeschriftung: 1 = „trifft gar nicht zu“, 5 = „trifft voll zu“
    - _Requirements: 8.2, 8.3, 8.5, 8.6, 8.13–8.16_
  - [ ]* 11.4 Tests für den Teilnahme-Ablauf
    - Properties 11, 16, 18 und 29 sowie Beispieltests „Teilnahme-Ablauf“
    - _Requirements: 7.19, 8.1–8.14_

- [x] 12. Auswertung
  - [x] 12.1 Admin-API `getCampaignEvaluation`: Zwischen- und Endauswertung, Hinweise, Schwelle, Verteilung, Differenzen, Kommentare, deaktivierte Items; unterdrückte Werte verlassen den Server nicht
    - _Requirements: 9.1–9.10, 10.1–10.3, 10.6–10.14, 10.17, 10.19_
  - [x] 12.2 Admin-Oberfläche: Übersicht aller Werte mit drei Perspektiven auf gemeinsamer Skala, Detail je Wert mit drei Verteilungsdiagrammen (Recharts), Kennzahlen, hervorgehobene Differenzen, Kommentare, Tabellen als Textalternative
    - _Requirements: 10.1–10.3, 10.6, 10.12–10.14, 10.16–10.18_
  - [x]* 12.3 Tests für die Auswertungs-API
    - Property 26 sowie Beispieltests „Anonymitätsschwelle und Zwischenauswertung“ und „Verteilung und Perspektiven“
    - _Requirements: 10.1–10.14_

- [ ] 13. Beispieldaten, Deployment und Dokumentation
  - [ ] 13.1 Seed-Skript mit zwei bis drei Beispiel-Unternehmenswerten, Fokussätzen und freigegebenen Items
    - _Requirements: 2.1, 2.4, 5.1_
  - [ ] 13.2 Migrationen auf das Supabase-Projekt anwenden; Vercel-Projekt einrichten und Umgebungsvariablen setzen; erstes Deployment
    - _Requirements: tech.md_
  - [ ] 13.3 README: lokales Setup, Umgebungsvariablen, Migrationen, Seed, Deployment, ersten Administrator anlegen
    - _Requirements: tech.md_
  - [ ] 13.4 Durchgängiger Test des Kernablaufs auf der Vercel-Umgebung (von Werten bis Auswertung)
    - _Requirements: 2, 5, 6, 7, 8, 10_

- [x] 14. Unternehmungen, Benutzer und Rollen
  - [x] 14.1 Migration: Tabellen `organization` und `organization_member` (Rollen `ADMIN`, `WERTE`, `KAMPAGNEN`), `organization_id` an Werten, Items und Kampagnen, Werte-Namen eindeutig je Unternehmung, Trigger gegen Zuordnungen über Unternehmungsgrenzen; bestehende Daten einer Standard-Unternehmung zugeordnet
    - _Requirements: 2.3, 12.1, 12.2, 12.5_
  - [x] 14.2 Backend: `AuthGuard` für alle gültigen Konten, `orgContext` (Header `X-Organization-Id`), `requireRole`, `requirePlatformAdmin`; alle Abfragen nach Unternehmung gefiltert
    - _Requirements: 1.4, 12.1, 12.9, 12.10_
  - [x] 14.3 Backend: `/me`, Unternehmungen (Plattform-Administratoren), Benutzer der Unternehmung inkl. Einladung per E-Mail und Schutz der letzten Benutzer-Administration
    - _Requirements: 12.3–12.8, 12.11_
  - [x] 14.4 Frontend: Auswahl der aktiven Unternehmung, Navigation nach Rollen, Seiten „Benutzer" und „Unternehmungen", Hinweis ohne Zuordnung
    - _Requirements: 12.9, 12.11, 12.12_
  - [x]* 14.5 Integrationstests für Trennung der Unternehmungen, Rollen und Benutzerverwaltung (Properties 33 und 34)
    - _Requirements: 12.1–12.10_

- [ ] 15. Anbieterunabhängige Datenbank und Anmeldung (Wechsel zu Neon)
  - [x] 15.1 Phase 0: Migrationen in `db/migrations` mit eigenem Runner (`schema_migrations`, Baseline); Plattform-Administratoren in `platform_admin`; Benutzer-IDs als Text; Anmeldung hinter `AuthProvider` (Backend) und `AuthClient` (Frontend), Supabase als erste Umsetzung; Produktion auf Supabase umgestellt
  - [ ] 15.2 Phase 1: Neon-Projekt (Frankfurt) mit Managed Better Auth, Migrationen einspielen, Vercel-Region `fra1`
  - [ ] 15.3 Phase 2: `AuthProvider`/`AuthClient` für Neon Auth (Better Auth), inkl. Einladung und Passwort festlegen; Test in einer Vorschau-Umgebung
  - [ ] 15.4 Phase 3: Daten von Supabase nach Neon kopieren, Mitgliedschaften und Plattform-Administratoren über die E-Mail-Adresse den neuen Konten zuordnen
  - [ ] 15.5 Phase 4: Produktion umschalten (`DATABASE_URL`, `AUTH_PROVIDER`), Supabase als Rückfallebene behalten, danach Wertebarometer-Daten aus Supabase entfernen

## Nach dem Prototyp

Diese Anforderungen sind im Design beschrieben, aber nicht Teil des ersten Prototyps:

- Sperre nach fünf Fehlversuchen und Inaktivitäts-Timeout (1.3, 1.6)
- KI-Verfeinerung von Items (3.13–3.16)
- Oberfläche für die Versionshistorie einer Item-Familie (5.24)
- Pool aus einer früheren Kampagne übernehmen (6.7, 6.8)
- Items in einer laufenden Kampagne deaktivieren (6.15–6.23), inkl. Anzeige deaktivierter Items in der Auswertung
- Einmal-Links per E-Mail mit `MailPort` (7.7–7.10, 7.18)
- Begrenzung ungewöhnlich häufiger Übermittlungen (7.5)
- CSV-Export (Anforderung 11)
