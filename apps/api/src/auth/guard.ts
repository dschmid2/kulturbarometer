/**
 * Anmeldung, Unternehmungs-Kontext und Rollen (Anforderung 1 und 12).
 *
 * - Jeder beim Anmeldedienst (siehe `provider.ts`) gültig angemeldete Benutzer passiert den AuthGuard.
 * - Plattform-Administratoren (Tabelle `platform_admin`, nur direkt in der Datenbank setzbar)
 *   verwalten Unternehmungen und haben in jeder Unternehmung alle Rollen.
 * - Alle übrigen Rechte hängen an der Mitgliedschaft in einer Unternehmung und deren Rollen.
 *   Die aktive Unternehmung kommt im Header `X-Organization-Id`.
 */
import { ROLE_LABELS, ROLES, type Role } from '@kb/shared';
import type { Request, RequestHandler } from 'express';
import type { Sql } from '../db/client.js';
import { AppError } from '../http/errors.js';
import type { AuthIdentity } from './provider.js';

export interface Identity {
  userId: string;
  email: string | null;
  platformAdmin: boolean;
}

export interface OrgContext {
  id: string;
  name: string;
  roles: Role[];
}

/** Prüft ein Zugriffstoken und liefert die vom Anmeldedienst bestätigte Identität oder `null`. */
export type VerifyToken = (token: string) => Promise<AuthIdentity | null>;

declare module 'express-serve-static-core' {
  interface Request {
    user?: Identity;
    org?: OrgContext;
  }
}

/** Schützt alle Admin-Routen (1.4): ohne gültiges Token keine Daten, sondern 401. */
export function authGuard(verify: VerifyToken, sql: () => Sql): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Bitte melden Sie sich an.');
    const identity = await verify(token);
    if (!identity) throw new AppError(401, 'UNAUTHENTICATED', 'Bitte melden Sie sich an.');
    const [admin] = await sql()`select 1 from platform_admin where user_id = ${identity.userId}`;
    req.user = { userId: identity.userId, email: identity.email, platformAdmin: !!admin };
    next();
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lädt die aktive Unternehmung aus `X-Organization-Id` und die Rollen des Benutzers darin.
 * Ohne Mitgliedschaft (und ohne Plattform-Admin-Recht) wird der Zugriff mit 403 verweigert.
 */
export function orgContext(sql: () => Sql): RequestHandler {
  return async (req, _res, next) => {
    const id = req.header('x-organization-id') ?? '';
    if (!UUID.test(id)) {
      throw new AppError(400, 'ORGANIZATION_REQUIRED', 'Bitte eine Unternehmung auswählen.');
    }
    const user = req.user!;
    const [row] = await sql()<{ name: string; roles: Role[] | null }[]>`
      select o.name, m.roles
      from organization o
      left join organization_member m on m.organization_id = o.id and m.user_id = ${user.userId}
      where o.id = ${id}`;
    if (!row || (!row.roles && !user.platformAdmin)) {
      throw new AppError(403, 'FORBIDDEN', 'Kein Zugriff auf diese Unternehmung.');
    }
    req.org = { id, name: row.name, roles: user.platformAdmin ? [...ROLES] : row.roles! };
    next();
  };
}

/** Verlangt mindestens eine der genannten Rollen in der aktiven Unternehmung. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.org || !roles.some((r) => req.org!.roles.includes(r))) {
      const names = roles.map((r) => `„${ROLE_LABELS[r]}"`).join(' oder ');
      throw new AppError(403, 'FORBIDDEN', `Für diese Aktion fehlt die Rolle ${names}.`);
    }
    next();
  };
}

/** Verlangt das Plattform-Administrator-Recht (Unternehmungen verwalten). */
export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user?.platformAdmin) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Nur Plattform-Administratoren dürfen Unternehmungen verwalten.',
    );
  }
  next();
};

/** ID der aktiven Unternehmung (nach `orgContext`). */
export function orgId(req: Request): string {
  if (!req.org) throw new Error('orgContext fehlt vor dieser Route.');
  return req.org.id;
}
