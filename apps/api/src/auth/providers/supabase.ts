/**
 * Anmeldedienst Supabase Auth. Einzige Stelle im Backend, die Supabase kennt.
 *
 * Benötigt `SUPABASE_URL` und `SUPABASE_PUBLISHABLE_KEY`; Einladungen zusätzlich
 * `SUPABASE_SECRET_KEY`. Konten werden in `auth.users` nachgeschlagen; das setzt voraus, dass
 * die Datenbank das Supabase-Projekt ist.
 */
import { createClient } from '@supabase/supabase-js';
import type { Sql } from '../../db/client.js';
import { AppError } from '../../http/errors.js';
import type { AuthProvider, DirectoryUser } from '../provider.js';

export function supabaseAuthProvider(sql: () => Sql): AuthProvider {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL und SUPABASE_PUBLISHABLE_KEY müssen gesetzt sein.');
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    name: 'supabase',
    async verifyToken(token) {
      const { data, error } = await client.auth.getClaims(token);
      if (error || !data) return null;
      const claims = data.claims as { sub?: string; email?: string };
      if (!claims.sub) return null;
      return { userId: claims.sub, email: claims.email ?? null };
    },
    directory: {
      async findByEmail(email) {
        const [row] = await sql()<DirectoryUser[]>`
          select id::text as id, email from auth.users where lower(email) = lower(${email}) limit 1`;
        return row ?? null;
      },
      async invite(email, redirectTo) {
        const secret = process.env.SUPABASE_SECRET_KEY;
        if (!secret) return null;
        const admin = createClient(url, secret, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          ...(redirectTo ? { redirectTo } : {}),
        });
        if (error || !data.user) {
          throw new AppError(
            502,
            'INVITE_FAILED',
            `Die Einladung konnte nicht versendet werden: ${error?.message ?? 'unbekannter Fehler'}`,
          );
        }
        return { id: data.user.id, email: data.user.email ?? email };
      },
    },
  };
}
