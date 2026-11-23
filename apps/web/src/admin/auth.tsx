import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { setUnauthenticatedHandler } from '../lib/api';
import { supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    // Meldet das Backend 401, wird abgemeldet und die Anmeldeseite angezeigt (1.4).
    setUnauthenticatedHandler(() => {
      sessionStorage.setItem(
        'kb-login-notice',
        'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.',
      );
      void supabase?.auth.signOut();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  /**
   * Abmelden (1.5): beendet die Sitzung bei Supabase (Token wird ungültig). Ist Supabase nicht
   * erreichbar, wird die Sitzung zumindest im Browser beendet, damit niemand angemeldet bleibt.
   */
  const signOut = async () => {
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.signOut();
      if (!error) return;
    } catch {
      /* Netzwerkfehler: unten lokal abmelden */
    }
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, loading, signOut }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
