/** Anmeldedienst Supabase Auth – einzige Stelle im Frontend, die supabase-js kennt. */
import { createClient, type AuthError, type Session } from '@supabase/supabase-js';
import { clearLink, readLink, storeLink } from './link';
import type { AuthClient, AuthErrorCode, AuthResult, AuthSession } from './types';

const toSession = (s: Session | null): AuthSession | null =>
  s ? { user: { id: s.user.id, email: s.user.email ?? null } } : null;

function toCode(err: AuthError): AuthErrorCode {
  switch (err.code) {
    case 'invalid_credentials':
      return 'invalid_credentials';
    case 'weak_password':
      return 'weak_password';
    case 'same_password':
      return 'same_password';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rate_limited';
    default:
      return 'unknown';
  }
}

const result = (error: AuthError | null): AuthResult =>
  error ? { ok: false, code: toCode(error) } : { ok: true };

export function createSupabaseAuthClient(url: string, key: string): AuthClient {
  // Supabase hängt bei Einladungs- und Wiederherstellungslinks `type=…` an das URL-Fragment und
  // meldet die Person dabei an. Vor dem Auswerten durch supabase-js lesen.
  const type = new URLSearchParams(window.location.hash.slice(1)).get('type');
  if (type === 'invite' || type === 'recovery') storeLink({ type });

  const client = createClient(url, key);
  return {
    name: 'supabase',
    async getSession() {
      const { data } = await client.auth.getSession();
      return toSession(data.session);
    },
    async getAccessToken() {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },
    onSessionChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, s) => listener(toSession(s)));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return result(error);
    },
    async signOut(scope) {
      try {
        const { error } = await client.auth.signOut({ scope });
        return result(error);
      } catch {
        return { ok: false, code: 'unknown' };
      }
    },
    async changePassword(current, next) {
      const { data } = await client.auth.getSession();
      const email = data.session?.user.email;
      if (!email) return { ok: false, code: 'unknown' };
      // Aktuelles Passwort über eine frische Anmeldung bestätigen.
      const check = await client.auth.signInWithPassword({ email, password: current });
      if (check.error) return result(check.error);
      const update = await client.auth.updateUser({ password: next });
      if (update.error) return result(update.error);
      await client.auth.signOut({ scope: 'others' }).catch(() => undefined);
      return { ok: true };
    },
    pendingPasswordLink() {
      return readLink()?.type ?? null;
    },
    async setPasswordFromLink(next) {
      // Der Link hat die Person bereits angemeldet.
      const { error } = await client.auth.updateUser({ password: next });
      if (error) return result(error);
      clearLink();
      await client.auth.signOut({ scope: 'others' }).catch(() => undefined);
      return { ok: true };
    },
  };
}
