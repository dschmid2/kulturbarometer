import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from 'express';
import { AppError } from '../http/errors.js';

export interface AdminIdentity {
  userId: string;
  email: string | null;
}

/** Prüft ein Zugriffstoken und liefert die Identität eines Administrators oder `null`. */
export type VerifyAdmin = (token: string) => Promise<AdminIdentity | null>;

/**
 * Standard-Prüfung über Supabase Auth: Signatur und Ablauf des Tokens werden über
 * `getClaims` geprüft. Administrator ist nur, wer `app_metadata.kb_role = 'admin'` trägt;
 * dieses Feld kann nur serverseitig gesetzt werden, nicht durch den Benutzer selbst.
 */
export function supabaseVerifyAdmin(): VerifyAdmin {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error('SUPABASE_URL und SUPABASE_PUBLISHABLE_KEY müssen gesetzt sein.');
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
    if (!claims.sub || claims.app_metadata?.kb_role !== 'admin') return null;
    return { userId: claims.sub, email: claims.email ?? null };
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminIdentity;
  }
}

/** Schützt alle Admin-Routen (1.4): ohne gültiges Token keine Daten, sondern 401. */
export function authGuard(verify: VerifyAdmin): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Bitte melden Sie sich an.');
    const admin = await verify(token);
    if (!admin) throw new AppError(401, 'UNAUTHENTICATED', 'Bitte melden Sie sich an.');
    req.admin = admin;
    next();
  };
}
