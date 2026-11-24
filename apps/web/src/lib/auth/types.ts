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
}

/** Vereinheitlichte Fehlercodes, damit die Oberfläche anbieterunabhängige Meldungen zeigt. */
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'weak_password'
  | 'same_password'
  | 'rate_limited'
  | 'link_invalid'
  | 'unknown';

export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode };

/** Art des Links, über den die Person gekommen ist (Einladung oder Passwort vergessen). */
export type PasswordLinkType = 'invite' | 'recovery';

export interface AuthClient {
  name: string;
  getSession(): Promise<AuthSession | null>;
  /** Zugriffstoken für `Authorization: Bearer …` an das eigene Backend (bei Bedarf erneuert). */
  getAccessToken(): Promise<string | null>;
  /** Meldet jede Änderung der Sitzung; liefert eine Funktion zum Abmelden des Beobachters. */
  onSessionChange(listener: (session: AuthSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthResult>;
  /** `global`: alle Geräte, `local`: nur dieser Browser. */
  signOut(scope: 'global' | 'local'): Promise<AuthResult>;
  /** Prüft das aktuelle Passwort, setzt das neue und meldet andere Geräte ab. */
  changePassword(current: string, next: string): Promise<AuthResult>;
  /** Kam die Person über einen Einladungs- oder Wiederherstellungslink? (beim Laden erkannt) */
  pendingPasswordLink(): PasswordLinkType | null;
  /** Legt über diesen Link ein neues Passwort fest. */
  setPasswordFromLink(next: string): Promise<AuthResult>;
}
