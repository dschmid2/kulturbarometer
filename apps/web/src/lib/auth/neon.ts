/**
 * Anmeldedienst Neon Auth (Managed Better Auth) – einzige Stelle im Frontend, die Neon kennt.
 * Der Browser spricht Neon Auth über `/api/auth` unseres Backends an (Proxy), damit die
 * Sitzungs-Cookies auf unserer Domain liegen.
 */
import { createAuthClient } from '@neon/auth';
import { clearLink, readLink, storeLink } from './link';
import type { AuthClient, AuthErrorCode, AuthResult, AuthSession } from './types';

/** Fehlerform des SDK: vereinheitlichter Code oben, ursprünglicher Better-Auth-Code in `error`. */
interface BetterAuthError {
  code?: string;
  status?: number;
  message?: string;
  error?: { code?: string; status?: number };
}

function toCode(err: BetterAuthError): AuthErrorCode {
  const status = err.error?.status ?? err.status;
  if (status === 429) return 'rate_limited';
  switch (err.error?.code ?? err.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
    case 'CREDENTIAL_ACCOUNT_NOT_FOUND':
      return 'invalid_credentials';
    case 'PASSWORD_TOO_SHORT':
    case 'PASSWORD_TOO_LONG':
      return 'weak_password';
    case 'INVALID_TOKEN':
      return 'link_invalid';
    default:
      return 'unknown';
  }
}

const result = (r: { error?: BetterAuthError | null }): AuthResult =>
  r.error ? { ok: false, code: toCode(r.error) } : { ok: true };

/** Fehler des SDK (Ausnahmen) ebenfalls als Ergebnis zurückgeben. */
async function attempt(fn: () => Promise<{ error?: BetterAuthError | null }>): Promise<AuthResult> {
  try {
    return result(await fn());
  } catch (e) {
    return { ok: false, code: toCode(e as BetterAuthError) };
  }
}

export function createNeonAuthClient(): AuthClient {
  // Einladungs- und Wiederherstellungslinks führen mit `?token=…` zurück zur Anwendung.
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    storeLink({ type: params.has('einladung') ? 'invite' : 'recovery', token });
    params.delete('token');
    params.delete('einladung');
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
  }

  const client = createAuthClient(`${window.location.origin}/api/auth`);
  const listeners = new Set<(s: AuthSession | null) => void>();

  /** Mit `fresh` am Sitzungs-Cache des SDK vorbei (z. B. direkt nach der Anmeldung). */
  async function getSession(fresh = false): Promise<AuthSession | null> {
    try {
      const { data } = await client.getSession(
        fresh ? { fetchOptions: { headers: { 'X-Force-Fetch': 'true' } } } : undefined,
      );
      if (!data?.user) return null;
      return { user: { id: data.user.id, email: data.user.email ?? null } };
    } catch {
      return null;
    }
  }
  async function notify() {
    const s = await getSession(true);
    listeners.forEach((l) => l(s));
  }

  return {
    name: 'neon',
    getSession: () => getSession(),
    async getAccessToken() {
      // Das SDK legt das JWT (15 Minuten gültig) in `session.token` und erneuert es bei Bedarf.
      try {
        const { data } = await client.getSession();
        return data?.session?.token ?? null;
      } catch {
        return null;
      }
    },
    onSessionChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email, password) {
      const r = await attempt(() => client.signIn.email({ email, password }));
      if (r.ok) await notify();
      return r;
    },
    async signOut() {
      // Better Auth beendet die Sitzung serverseitig; danach ist auch dieser Browser abgemeldet.
      const r = await attempt(() => client.signOut());
      await notify();
      return r;
    },
    async changePassword(current, next) {
      return attempt(() =>
        client.changePassword({
          currentPassword: current,
          newPassword: next,
          revokeOtherSessions: true,
        }),
      );
    },
    pendingPasswordLink() {
      return readLink()?.type ?? null;
    },
    async setPasswordFromLink(next) {
      const link = readLink();
      if (!link?.token) return { ok: false, code: 'link_invalid' };
      const r = await attempt(() =>
        client.resetPassword({ newPassword: next, token: link.token! }),
      );
      if (r.ok) clearLink();
      return r;
    },
  };
}
