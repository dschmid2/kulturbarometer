/**
 * Schnittstelle zum Anmeldedienst im Browser. Die Oberfläche kennt nur diese Schnittstelle;
 * die Umsetzung (Supabase Auth, Neon Auth/Better Auth, …) wählt `VITE_AUTH_PROVIDER`.
 */
export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthSession {
  user: AuthUser;
  /** Zugriffstoken für `Authorization: Bearer …` an das eigene Backend. */
  accessToken: string;
}

/** Vereinheitlichte Fehlercodes, damit die Oberfläche anbieterunabhängige Meldungen zeigt. */
export type AuthErrorCode =
  'invalid_credentials' | 'weak_password' | 'same_password' | 'rate_limited' | 'unknown';

export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode };

export interface AuthClient {
  name: string;
  getSession(): Promise<AuthSession | null>;
  /** Meldet jede Änderung der Sitzung; liefert eine Funktion zum Abmelden des Beobachters. */
  onSessionChange(listener: (session: AuthSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthResult>;
  /** `global`: alle Geräte, `local`: nur dieser Browser, `others`: alle anderen Geräte. */
  signOut(scope: 'global' | 'local' | 'others'): Promise<AuthResult>;
  updatePassword(newPassword: string): Promise<AuthResult>;
}
