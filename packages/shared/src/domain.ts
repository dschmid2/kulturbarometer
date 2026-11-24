/** Fachliche Grundbegriffe des Wertebarometers (siehe Glossar in requirements.md). */

export const PERSPECTIVES = ['SELBST', 'TEAM', 'FUEHRUNG'] as const;
export type Perspective = (typeof PERSPECTIVES)[number];

export const PERSPECTIVE_LABELS: Record<Perspective, string> = {
  SELBST: 'Selbst',
  TEAM: 'Team',
  FUEHRUNG: 'Führung',
};

export const ITEM_TYPES = ['FRAGE', 'SITUATION'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** In der Oberfläche heißen Items „Fragen"; ihre Art ist „Aussage" oder „Szenario". */
export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  FRAGE: 'Aussage',
  SITUATION: 'Szenario',
};

export const ITEM_STATUSES = ['ZUR_PRUEFUNG', 'FREIGEGEBEN', 'DEAKTIVIERT'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  ZUR_PRUEFUNG: 'zur Prüfung',
  FREIGEGEBEN: 'freigegeben',
  DEAKTIVIERT: 'deaktiviert',
};

export const ITEM_ORIGINS = ['MANUELL', 'KI', 'IMPORT'] as const;
export type ItemOrigin = (typeof ITEM_ORIGINS)[number];

export const CAMPAIGN_STATUSES = ['ENTWURF', 'AKTIV', 'ABGESCHLOSSEN'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  ENTWURF: 'Entwurf',
  AKTIV: 'Aktiv',
  ABGESCHLOSSEN: 'Abgeschlossen',
};

export const DISTRIBUTION_MODES = ['PUBLIC_LINK', 'EMAIL_ONE_TIME'] as const;
export type DistributionMode = (typeof DISTRIBUTION_MODES)[number];

/** Skala der Ist-Bewertung (Anforderung 8.2). */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** Anonymitätsschwelle (Anforderung 6.28). */
export const ANONYMITY_THRESHOLD_MIN = 3;
export const ANONYMITY_THRESHOLD_MAX = 100;
export const ANONYMITY_THRESHOLD_DEFAULT = 5;

/** Grenzen der fünf Verteilungsklassen (Glossar „Verteilungsklasse"). */
export const DISTRIBUTION_CLASS_BOUNDS = [1.8, 2.6, 3.4, 4.2] as const;
export const DISTRIBUTION_CLASS_LABELS = [
  '1,00–1,79',
  '1,80–2,59',
  '2,60–3,39',
  '3,40–4,19',
  '4,20–5,00',
] as const;

/** Ab diesem Betrag wird eine Perspektivdifferenz hervorgehoben (Anforderung 10.17). */
export const PERSPECTIVE_GAP_HIGHLIGHT = 0.5;

/** Erlaubte Statusübergänge der Kampagne (Anforderung 6.26). */
export function isAllowedCampaignTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return (from === 'ENTWURF' && to === 'AKTIV') || (from === 'AKTIV' && to === 'ABGESCHLOSSEN');
}

/** Rollen eines Benutzers innerhalb einer Unternehmung (Anforderung 12). */
export const ROLES = ['ADMIN', 'WERTE', 'KAMPAGNEN'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Benutzer-Administration',
  WERTE: 'Werte-Administration',
  KAMPAGNEN: 'Kampagnen-Administration',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: 'Benutzer der Unternehmung zuordnen und Rollen vergeben',
  WERTE: 'Unternehmenswerte, Fokussätze und Fragen verwalten',
  KAMPAGNEN: 'Kampagnen durchführen und Auswertungen einsehen',
};
