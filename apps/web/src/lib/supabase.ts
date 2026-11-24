import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Kommt die Person über einen Einladungs- oder Wiederherstellungslink, steht der Typ im
 * URL-Fragment. Er wird gelesen, bevor supabase-js das Fragment auswertet und entfernt, damit
 * die Oberfläche anschliessend zum Festlegen eines Passworts führen kann.
 */
export const SET_PASSWORD_FLAG = 'kb-set-password';
if (typeof window !== 'undefined') {
  const type = new URLSearchParams(window.location.hash.slice(1)).get('type');
  if (type === 'invite' || type === 'recovery') sessionStorage.setItem(SET_PASSWORD_FLAG, type);
}

/** Supabase wird im Frontend ausschließlich für die Anmeldung der Administratoren verwendet. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
