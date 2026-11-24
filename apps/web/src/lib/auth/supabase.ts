/** Anmeldedienst Supabase Auth – einzige Stelle im Frontend, die supabase-js kennt. */
import { createClient, type AuthError, type Session } from '@supabase/supabase-js';
import type { AuthClient, AuthErrorCode, AuthResult, AuthSession } from './types';

const toSession = (s: Session | null): AuthSession | null =>
  s ? { user: { id: s.user.id, email: s.user.email ?? null }, accessToken: s.access_token } : null;

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
  const client = createClient(url, key);
  return {
    name: 'supabase',
    async getSession() {
      const { data } = await client.auth.getSession();
      return toSession(data.session);
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
    async updatePassword(newPassword) {
      const { error } = await client.auth.updateUser({ password: newPassword });
      return result(error);
    },
  };
}

/** Supabase hängt bei Einladungs- und Wiederherstellungslinks `type=…` an das URL-Fragment. */
export function supabaseLinkType(hash: string): 'invite' | 'recovery' | null {
  const type = new URLSearchParams(hash.slice(1)).get('type');
  return type === 'invite' || type === 'recovery' ? type : null;
}
