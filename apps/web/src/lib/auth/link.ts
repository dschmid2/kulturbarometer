/** Merkt sich einen Einladungs- oder Wiederherstellungslink über ein Neuladen der Seite hinweg. */
import type { PasswordLinkType } from './types';

const KEY = 'kb-password-link';

export interface StoredLink {
  type: PasswordLinkType;
  /** Nur bei Anbietern, die den Link per Token einlösen (z. B. Neon Auth). */
  token?: string;
}

export function storeLink(link: StoredLink) {
  sessionStorage.setItem(KEY, JSON.stringify(link));
}

export function readLink(): StoredLink | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredLink) : null;
  } catch {
    return null;
  }
}

export function clearLink() {
  sessionStorage.removeItem(KEY);
}
