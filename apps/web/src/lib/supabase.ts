import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Supabase wird im Frontend ausschließlich für die Anmeldung der Administratoren verwendet. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
