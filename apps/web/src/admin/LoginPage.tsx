import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(() => {
    const notice = sessionStorage.getItem('kb-login-notice');
    sessionStorage.removeItem('kb-login-notice');
    return notice;
  });
  const [busy, setBusy] = useState(false);

  if (!supabase) {
    return (
      <main className="page narrow">
        <h1>Kulturbarometer</h1>
        <p className="error">
          Die Anmeldung ist nicht konfiguriert (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
          fehlen).
        </p>
      </main>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase!.auth.signInWithPassword({ email, password });
    setBusy(false);
    // Generische Meldung ohne Angabe, welches Feld falsch war (1.2).
    if (err) setError('Die Anmeldedaten sind ungültig.');
  };

  return (
    <main className="page narrow">
      <h1>Kulturbarometer</h1>
      <p className="muted">Anmeldung für Administratoren</p>
      <form className="form" onSubmit={submit}>
        <label>
          E-Mail
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Passwort
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Anmelden …' : 'Anmelden'}
        </button>
      </form>
    </main>
  );
}
