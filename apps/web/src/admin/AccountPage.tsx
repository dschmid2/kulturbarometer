import { PASSWORD_MAX, PASSWORD_MIN, validatePasswordChange } from '@kb/shared';
import { useState, type FormEvent } from 'react';
import { SET_PASSWORD_FLAG, supabase } from '../lib/supabase';
import { useAuth } from './auth';

/** Übersetzt Fehler von Supabase Auth in verständliche Meldungen. */
function authMessage(err: { code?: string; message: string }): string {
  switch (err.code) {
    case 'weak_password':
      return 'Das Passwort ist zu schwach. Verwenden Sie ein längeres Passwort mit Buchstaben, Ziffern und Sonderzeichen.';
    case 'same_password':
      return 'Das neue Passwort muss sich vom bisherigen unterscheiden.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Zu viele Versuche. Bitte warten Sie einen Moment und versuchen Sie es erneut.';
    default:
      return 'Das Passwort konnte nicht geändert werden. Bitte versuchen Sie es erneut.';
  }
}

/** Konto: Passwort ändern, nach einer Einladung oder Wiederherstellung Passwort festlegen. */
export function AccountPage() {
  const { session } = useAuth();
  const email = session?.user.email ?? '';
  const [setNew, setSetNew] = useState(() => sessionStorage.getItem(SET_PASSWORD_FLAG));
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const found = validatePasswordChange({ current: setNew ? null : current, next, repeat });
    setErrors(found);
    if (Object.keys(found).length > 0 || !supabase) return;
    setBusy(true);
    try {
      if (!setNew) {
        // Aktuelles Passwort bestätigen (frische Anmeldung), bevor es geändert wird.
        const { error } = await supabase.auth.signInWithPassword({ email, password: current });
        if (error) {
          setErrors({ current: 'Das aktuelle Passwort ist falsch.' });
          return;
        }
      }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) {
        setMessage({ ok: false, text: authMessage(error) });
        return;
      }
      // Andere Sitzungen (andere Geräte) beenden; diese bleibt angemeldet.
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);
      sessionStorage.removeItem(SET_PASSWORD_FLAG);
      setSetNew(null);
      setCurrent('');
      setNext('');
      setRepeat('');
      setMessage({
        ok: true,
        text: setNew
          ? 'Ihr Passwort ist festgelegt. Sie melden sich künftig damit an.'
          : 'Ihr Passwort wurde geändert. Andere angemeldete Geräte wurden abgemeldet.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="toolbar">
        <div>
          <span className="eyebrow">Konto</span>
          <h1>{setNew ? 'Passwort festlegen' : 'Passwort ändern'}</h1>
          <p className="muted">
            Angemeldet als <strong>{email}</strong>
          </p>
        </div>
      </div>
      {setNew && (
        <p className="info">
          {setNew === 'invite'
            ? 'Willkommen! Legen Sie ein Passwort fest, damit Sie sich künftig anmelden können.'
            : 'Legen Sie ein neues Passwort fest.'}
        </p>
      )}
      <form className="form panel narrow-form" onSubmit={submit} noValidate>
        {/* Für Passwort-Manager: zugehöriger Benutzername */}
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        {!setNew && (
          <label>
            Aktuelles Passwort
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              aria-invalid={!!errors.current}
            />
            {errors.current && <span className="field-error">{errors.current}</span>}
          </label>
        )}
        <label>
          Neues Passwort ({PASSWORD_MIN}–{PASSWORD_MAX} Zeichen)
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-invalid={!!errors.next}
          />
          {errors.next && <span className="field-error">{errors.next}</span>}
        </label>
        <label>
          Neues Passwort wiederholen
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            aria-invalid={!!errors.repeat}
          />
          {errors.repeat && <span className="field-error">{errors.repeat}</span>}
        </label>
        {message && (
          <p className={message.ok ? 'success' : 'error'} role={message.ok ? 'status' : 'alert'}>
            {message.text}
          </p>
        )}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Speichern …' : setNew ? 'Passwort festlegen' : 'Passwort ändern'}
          </button>
        </div>
      </form>
    </section>
  );
}
