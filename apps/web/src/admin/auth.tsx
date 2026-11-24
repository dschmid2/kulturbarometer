import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { setUnauthenticatedHandler } from '../lib/api';
import { auth, type AuthSession } from '../lib/auth';

interface AuthState {
  session: AuthSession | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    void auth.getSession().then((s) => {
      setSession(s);
      setLoading(false);
    });
    const unsubscribe = auth.onSessionChange(setSession);
    // Meldet das Backend 401, wird abgemeldet und die Anmeldeseite angezeigt (1.4).
    setUnauthenticatedHandler(() => {
      sessionStorage.setItem(
        'kb-login-notice',
        'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.',
      );
      void auth?.signOut('local');
    });
    return unsubscribe;
  }, []);

  /**
   * Abmelden (1.5): beendet die Sitzung beim Anmeldedienst (Token wird ungültig). Ist der Dienst
   * nicht erreichbar, wird die Sitzung zumindest im Browser beendet, damit niemand angemeldet bleibt.
   */
  const signOut = async () => {
    if (!auth) return;
    const res = await auth.signOut('global');
    if (res.ok) return;
    await auth.signOut('local');
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, loading, signOut }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
