import { useState, type FormEvent } from 'react';
import { BrandMark, Wordmark } from '../BrandMark';
import { auth, authConfigError } from '../lib/auth';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(() => {
    const notice = sessionStorage.getItem('kb-login-notice');
    sessionStorage.removeItem('kb-login-notice');
    return notice;
  });
  const [busy, setBusy] = useState(false);

  if (!auth) {
    return (
      <main className="page narrow">
        <BrandMark size={40} />
        <h1>Wertebarometer</h1>
        <p className="error">{authConfigError}</p>
      </main>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await auth!.signIn(email, password);
    setBusy(false);
    // Generische Meldung ohne Angabe, welches Feld falsch war (1.2).
    if (!res.ok) {
      setError(
        res.code === 'rate_limited'
          ? 'Zu viele Anmeldeversuche. Bitte warten Sie einen Moment.'
          : 'Die Anmeldedaten sind ungültig.',
      );
    }
  };

  return (
    <div className="login">
      <section className="login-hero">
        <Wordmark />
        <div>
          <span className="eyebrow">Unternehmenswerte messen</span>
          <h1>
            Wie <em>gelebt</em> sind eure Werte?
          </h1>
          <p>
            Das Wertebarometer zeigt, wie Unternehmenswerte im Daily Business wirken – aus Sicht
            jeder einzelnen Person, des Teams und der Führung.
          </p>
        </div>
        <svg className="login-shapes" viewBox="0 0 27 27" aria-hidden="true">
          <rect width="12" height="12" fill="#FF6A3D" />
          <circle cx="21" cy="6" r="6" fill="#D4F53C" />
          <rect y="15" width="12" height="12" fill="#fff" fillOpacity=".12" />
          <rect x="15" y="15" width="12" height="12" fill="#FF6A3D" fillOpacity=".55" />
        </svg>
      </section>
      <main className="login-form">
        <form className="form card" onSubmit={submit}>
          <div>
            <span className="eyebrow">Administration</span>
            <h2>Anmelden</h2>
          </div>
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
    </div>
  );
}
