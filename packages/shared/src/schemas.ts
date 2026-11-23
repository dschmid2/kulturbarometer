import { z } from 'zod';
import {
  ANONYMITY_THRESHOLD_MAX,
  ANONYMITY_THRESHOLD_MIN,
  ITEM_TYPES,
  PERSPECTIVES,
  RATING_MAX,
  RATING_MIN,
  ROLES,
} from './domain.js';

/** Text, der nicht leer und nicht nur aus Leerzeichen bestehen darf. */
const nonBlank = (max: number, emptyMsg: string, lengthMsg: string) =>
  z
    .string(emptyMsg)
    .max(max, lengthMsg)
    .refine((s) => s.trim().length > 0, emptyMsg);

// ---------------------------------------------------------------------------
// Unternehmenswerte (Anforderung 2)
// ---------------------------------------------------------------------------

export const valueInputSchema = z.object({
  name: nonBlank(
    100,
    'Bitte einen Namen angeben.',
    'Der Name darf höchstens 100 Zeichen lang sein.',
  ),
  description: z.string().max(1000, 'Die Beschreibung darf höchstens 1.000 Zeichen lang sein.'),
});
export type ValueInput = z.infer<typeof valueInputSchema>;

export const focusSentenceInputSchema = z.object({
  text: nonBlank(
    500,
    'Der Fokussatz muss 1 bis 500 Zeichen lang sein.',
    'Der Fokussatz muss 1 bis 500 Zeichen lang sein.',
  ),
});
export type FocusSentenceInput = z.infer<typeof focusSentenceInputSchema>;

// ---------------------------------------------------------------------------
// Items (Anforderung 5) – ein geteiltes Schema für Verwaltung, Import und KI
// ---------------------------------------------------------------------------

export const weightSchema = z
  .number('Die Gewichtung muss eine Zahl sein.')
  .min(0, 'Die Gewichtung muss zwischen 0 % und 100 % liegen.')
  .max(100, 'Die Gewichtung muss zwischen 0 % und 100 % liegen.');

const itemTextSchema = nonBlank(
  500,
  'Der Fragetext muss 1 bis 500 Zeichen lang sein.',
  'Der Fragetext muss 1 bis 500 Zeichen lang sein.',
);
const itemTypeSchema = z.enum(ITEM_TYPES, 'Bitte eine gültige Art wählen (Aussage oder Szenario).');
const perspectiveSchema = z.enum(
  PERSPECTIVES,
  'Bitte genau eine Perspektive (Selbst, Team oder Führung) wählen.',
);

const MIN_ONE_POSITIVE =
  'Die Frage muss mindestens einem Unternehmenswert mit einer Gewichtung größer als 0 % zugeordnet sein.';

/** Item mit Werte-Zuordnungen per ID (Admin-Oberfläche). */
export const itemInputSchema = z
  .object({
    text: itemTextSchema,
    itemType: itemTypeSchema,
    perspective: perspectiveSchema,
    assignments: z.array(z.object({ valueId: z.uuid(), weight: weightSchema })),
  })
  .superRefine((item, ctx) => {
    if (!item.assignments.some((a) => a.weight > 0)) {
      ctx.addIssue({ code: 'custom', path: ['assignments'], message: MIN_ONE_POSITIVE });
    }
    const ids = item.assignments.map((a) => a.valueId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['assignments'],
        message: 'Jeder Unternehmenswert darf nur einmal zugeordnet werden.',
      });
    }
  });
export type ItemInput = z.infer<typeof itemInputSchema>;

/** Item mit Werte-Zuordnungen per Name (Import-Datei und KI-Ausgabe, Anforderung 4.2). */
export const externalItemSchema = z
  .strictObject({
    text: itemTextSchema,
    itemType: itemTypeSchema,
    perspective: perspectiveSchema,
    assignments: z.array(
      z.strictObject({
        valueName: z.string().min(1, 'Der Name des Unternehmenswerts fehlt.'),
        weight: weightSchema,
      }),
    ),
  })
  .superRefine((item, ctx) => {
    if (!item.assignments.some((a) => a.weight > 0)) {
      ctx.addIssue({ code: 'custom', path: ['assignments'], message: MIN_ONE_POSITIVE });
    }
    const names = item.assignments.map((a) => a.valueName);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['assignments'],
        message: 'Jeder Unternehmenswert darf nur einmal zugeordnet werden.',
      });
    }
  });
export type ExternalItem = z.infer<typeof externalItemSchema>;

/** Oberste Ebene der Import-Datei (Anforderung 4.8); `values`/`itemSchema` werden ignoriert. */
export const importFileSchema = z.object({
  schemaVersion: z.number().int().optional(),
  items: z.array(z.unknown()),
});

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ITEMS = 1000;

// ---------------------------------------------------------------------------
// Kampagnen (Anforderung 6)
// ---------------------------------------------------------------------------

const isoDate = z.iso.date('Bitte ein gültiges Datum angeben.');

export const campaignInputSchema = z
  .object({
    title: nonBlank(
      200,
      'Der Titel muss 1 bis 200 Zeichen lang sein.',
      'Der Titel muss 1 bis 200 Zeichen lang sein.',
    ),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((c) => c.endDate > c.startDate, {
    path: ['endDate'],
    message: 'Das Enddatum muss nach dem Startdatum liegen.',
  });
export type CampaignInput = z.infer<typeof campaignInputSchema>;

export const itemsPerParticipantSchema = z
  .number()
  .int('Die Anzahl Fragen je Teilnehmer muss eine ganze Zahl sein.')
  .min(1, 'Die Anzahl Fragen je Teilnehmer muss mindestens 1 sein.');

export const anonymityThresholdSchema = z
  .number()
  .int(
    `Die Anonymitätsschwelle muss eine ganze Zahl von ${ANONYMITY_THRESHOLD_MIN} bis ${ANONYMITY_THRESHOLD_MAX} sein.`,
  )
  .min(
    ANONYMITY_THRESHOLD_MIN,
    `Die Anonymitätsschwelle muss zwischen ${ANONYMITY_THRESHOLD_MIN} und ${ANONYMITY_THRESHOLD_MAX} liegen.`,
  )
  .max(
    ANONYMITY_THRESHOLD_MAX,
    `Die Anonymitätsschwelle muss zwischen ${ANONYMITY_THRESHOLD_MIN} und ${ANONYMITY_THRESHOLD_MAX} liegen.`,
  );

// ---------------------------------------------------------------------------
// Teilnahme (Anforderung 8)
// ---------------------------------------------------------------------------

export const ratingSchema = z
  .number('Die Bewertung muss eine Zahl sein.')
  .min(RATING_MIN, 'Die Bewertung muss zwischen 1,00 und 5,00 liegen.')
  .max(RATING_MAX, 'Die Bewertung muss zwischen 1,00 und 5,00 liegen.');

export const answerSubmissionSchema = z.object({
  answers: z.array(
    z.object({
      snapshotItemId: z.uuid(),
      rating: ratingSchema,
      comment: z
        .string()
        .max(1000, 'Der Kommentar darf höchstens 1.000 Zeichen lang sein.')
        .optional(),
    }),
  ),
});
export type AnswerSubmission = z.infer<typeof answerSubmissionSchema>;

// ---------------------------------------------------------------------------
// Unternehmungen und Benutzer (Anforderung 12)
// ---------------------------------------------------------------------------

export const organizationInputSchema = z.object({
  name: nonBlank(
    200,
    'Bitte einen Namen für die Unternehmung angeben.',
    'Der Name darf höchstens 200 Zeichen lang sein.',
  ),
});
export type OrganizationInput = z.infer<typeof organizationInputSchema>;

const rolesSchema = z
  .array(z.enum(ROLES, 'Ungültige Rolle.'))
  .min(1, 'Bitte mindestens eine Rolle wählen.')
  .refine((r) => new Set(r).size === r.length, 'Jede Rolle darf nur einmal vorkommen.');

export const memberInputSchema = z.object({
  email: z.email('Bitte eine gültige E-Mail-Adresse angeben.'),
  roles: rolesSchema,
});
export type MemberInput = z.infer<typeof memberInputSchema>;

export const memberRolesSchema = z.object({ roles: rolesSchema });

/** Einstellungen einer Kampagne im Entwurf (6.1–6.3, 6.6, 6.28). */
export const campaignSettingsSchema = z
  .object({
    title: nonBlank(
      200,
      'Der Titel muss 1 bis 200 Zeichen lang sein.',
      'Der Titel muss 1 bis 200 Zeichen lang sein.',
    ),
    startDate: z.iso.date('Bitte ein gültiges Datum angeben.'),
    endDate: z.iso.date('Bitte ein gültiges Datum angeben.'),
    itemsPerParticipant: itemsPerParticipantSchema.nullable(),
    anonymityThreshold: anonymityThresholdSchema,
  })
  .refine((c) => c.endDate > c.startDate, {
    path: ['endDate'],
    message: 'Das Enddatum muss nach dem Startdatum liegen.',
  });
export type CampaignSettings = z.infer<typeof campaignSettingsSchema>;

/** Kampagnen-Pool als vollständige Liste der Fragen (6.4). */
export const campaignPoolSchema = z.object({
  itemIds: z.array(z.uuid('Ungültige Frage.')).max(2000, 'Höchstens 2.000 Fragen pro Kampagne.'),
});
