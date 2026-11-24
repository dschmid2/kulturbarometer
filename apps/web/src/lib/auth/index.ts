/**
 * Auswahl des Anmeldedienstes über `VITE_AUTH_PROVIDER` (Standard: `supabase`).
 * Ein weiterer Anbieter wird ergänzt, indem er `AuthClient` umsetzt und hier eingetragen wird.
 */
import { createNeonAuthClient } from './neon';
import { createSupabaseAuthClient } from './supabase';
import type { AuthClient } from './types';

export type {
  AuthClient,
  AuthErrorCode,
  AuthResult,
  AuthSession,
  AuthUser,
  PasswordLinkType,
} from './types';

const provider = (import.meta.env.VITE_AUTH_PROVIDER as string | undefined) ?? 'supabase';

/** Fehlende Konfiguration als lesbare Meldung (statt eines Absturzes). */
export let authConfigError: string | null = null;

function create(): AuthClient | null {
  if (typeof window === 'undefined') return null;
  switch (provider) {
    case 'supabase': {
      const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
      if (!url || !key) {
        authConfigError =
          'Die Anmeldung ist nicht konfiguriert (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY fehlen).';
        return null;
      }
      return createSupabaseAuthClient(url, key);
    }
    case 'neon':
      return createNeonAuthClient();
    default:
      authConfigError = `Unbekannter Anmeldedienst „${provider}" (VITE_AUTH_PROVIDER).`;
      return null;
  }
}

export const auth: AuthClient | null = create();
