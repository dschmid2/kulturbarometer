/**
 * Schnittstelle zum Anmeldedienst. Die übrige Anwendung kennt nur diese Schnittstelle; welcher
 * Dienst dahinter steht (Supabase Auth, Neon Auth/Better Auth, …), bestimmt `AUTH_PROVIDER`.
 * Berechtigungen (Plattform-Administratoren, Mitgliedschaften, Rollen) liegen ausschliesslich in
 * der eigenen Datenbank und sind damit unabhängig vom Anbieter.
 */
import type { Sql } from '../db/client.js';
import { supabaseAuthProvider } from './providers/supabase.js';

/** Vom Anmeldedienst bestätigte Identität. */
export interface AuthIdentity {
  userId: string;
  email: string | null;
}

export interface DirectoryUser {
  id: string;
  email: string;
}

/** Benutzerkonten nachschlagen und einladen. */
export interface UserDirectory {
  findByEmail(email: string): Promise<DirectoryUser | null>;
  /** Lädt ein neues Konto per E-Mail ein; `null`, wenn Einladungen nicht konfiguriert sind. */
  invite(email: string, redirectTo?: string): Promise<DirectoryUser | null>;
}

export interface AuthProvider {
  name: string;
  /** Prüft ein Zugriffstoken (Signatur, Ablauf) und liefert die Identität oder `null`. */
  verifyToken(token: string): Promise<AuthIdentity | null>;
  directory: UserDirectory;
}

export const AUTH_PROVIDERS = ['supabase'] as const;

/** Wählt den Anmeldedienst anhand von `AUTH_PROVIDER` (Standard: `supabase`). */
export function authProviderFromEnv(sql: () => Sql): AuthProvider {
  const name = process.env.AUTH_PROVIDER ?? 'supabase';
  switch (name) {
    case 'supabase':
      return supabaseAuthProvider(sql);
    default:
      throw new Error(
        `Unbekannter AUTH_PROVIDER „${name}". Erlaubt: ${AUTH_PROVIDERS.join(', ')}.`,
      );
  }
}
