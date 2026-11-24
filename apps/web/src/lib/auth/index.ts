/**
 * Auswahl des Anmeldedienstes über `VITE_AUTH_PROVIDER` (Standard: `supabase`).
 * Ein weiterer Anbieter wird ergänzt, indem er `AuthClient` umsetzt und hier eingetragen wird.
 */
import { createSupabaseAuthClient, supabaseLinkType } from './supabase';
import type { AuthClient } from './types';

export type { AuthClient, AuthErrorCode, AuthResult, AuthSession, AuthUser } from './types';

const provider = (import.meta.env.VITE_AUTH_PROVIDER as string | undefined) ?? 'supabase';

/** Fehlende Konfiguration als lesbare Meldung (statt eines Absturzes). */
export let authConfigError: string | null = null;

/**
 * Kommt die Person über einen Einladungs- oder Wiederherstellungslink, wird das vermerkt,
 * bevor der Anmeldedienst die URL auswertet, damit sie zuerst ein Passwort festlegt.
 */
export const SET_PASSWORD_FLAG = 'kb-set-password';

function create(): AuthClient | null {
  switch (provider) {
    case 'supabase': {
      const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
      if (!url || !key) {
        authConfigError =
          'Die Anmeldung ist nicht konfiguriert (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY fehlen).';
        return null;
      }
      const type = typeof window !== 'undefined' ? supabaseLinkType(window.location.hash) : null;
      if (type) sessionStorage.setItem(SET_PASSWORD_FLAG, type);
      return createSupabaseAuthClient(url, key);
    }
    default:
      authConfigError = `Unbekannter Anmeldedienst „${provider}" (VITE_AUTH_PROVIDER).`;
      return null;
  }
}

export const auth: AuthClient | null = create();
