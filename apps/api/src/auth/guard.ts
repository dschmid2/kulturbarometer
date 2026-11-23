/**
 * Anmeldung, Unternehmungs-Kontext und Rollen (Anforderung 1 und 12).
 *
 * - Jeder gültig angemeldete Supabase-Benutzer passiert den AuthGuard.
 * - Plattform-Administratoren (`app_metadata.kb_role = 'admin'`, nur serverseitig setzbar)
 *   verwalten Unternehmungen und haben in jeder Unternehmung alle Rollen.
 * - Alle übrigen Rechte hängen an der Mitgliedschaft in einer Unternehmung und deren Rollen.
 *   Die aktive Unternehmung kommt im Header `X-Organization-Id`.
 */
import { ROLE_LABELS, ROLES, type Role } from '@kb/shared';
import { createClient } from '@supabase/supabase-js';
import type { Request, RequestHandler } from 'express';
import type { Sql } from '../db/client.js';
import { AppError } from '../http/errors.js';

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

/** Prüft ein Zugriffstoken und liefert die Identität oder `null`. */
export type VerifyToken = (token: string) => Promise<Identity | null>;

/** Standard-Prüfung über Supabase Auth (Signatur und Ablauf via `getClaims`). */
export function supabaseVerifyToken(): VerifyToken {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL und SUPABASE_PUBLISHABLE_KEY müssen gesetzt sein.');
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return async (token) => {
    const { data, error } = await client.auth.getClaims(token);
    if (error || !data) return null;
    const claims = data.claims as {
      sub?: string;
      email?: string;
      app_metadata?: { kb_role?: string };
    };
    if (!claims.sub) return null;
    return {
      userId: claims.sub,
      email: claims.email ?? null,
      platformAdmin: claims.app_metadata?.kb_role === 'admin',
    };
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: Identity;
    org?: OrgContext;
  }
}

/** Schützt alle Admin-Routen (1.4): ohne gültiges Token keine Daten, sondern 401. */
export function authGuard(verify: VerifyToken): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Bitte melden Sie sich an.');
    const user = await verify(token);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Bitte melden Sie sich an.');
    req.user = user;
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
