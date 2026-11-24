import { PASSWORD_MAX, PASSWORD_MIN, validatePasswordChange } from '@kb/shared';
import { useState, type FormEvent } from 'react';
import { BrandMark } from '../BrandMark';
import { auth, type AuthErrorCode, type AuthResult, type PasswordLinkType } from '../lib/auth';
import { useAuth } from './auth';

/** Übersetzt die vereinheitlichten Fehlercodes des Anmeldedienstes in verständliche Meldungen. */
function authMessage(code: AuthErrorCode): string {
  switch (code) {
    case 'weak_password':
      return 'Das Passwort ist zu schwach. Verwenden Sie ein längeres Passwort mit Buchstaben, Ziffern und Sonderzeichen.';
    case 'same_password':
      return 'Das neue Passwort muss sich vom bisherigen unterscheiden.';
    case 'rate_limited':
      return 'Zu viele Versuche. Bitte warten Sie einen Moment und versuchen Sie es erneut.';
    case 'link_invalid':
      return 'Der Link ist abgelaufen oder ungültig. Bitte fordern Sie einen neuen an.';
    default:
      return 'Das Passwort konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.';
  }
}

/**
 * Formular für ein neues Passwort; mit `withCurrent` zusätzlich das aktuelle Passwort
 * (Passwort ändern), sonst nur neues Passwort (Passwort über einen Link festlegen).
 */
function PasswordForm({
  email,
  withCurrent,
  submitLabel,
  onSubmit,
  onDone,
}: {
  email: string;
  withCurrent: boolean;
  submitLabel: string;
  onSubmit: (current: string, next: string) => Promise<AuthResult>;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const found = validatePasswordChange({ current: withCurrent ? current : null, next, repeat });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const res = await onSubmit(current, next);
      if (!res.ok) {
        if (withCurrent && res.code === 'invalid_credentials') {
          setErrors({ current: 'Das aktuelle Passwort ist falsch.' });
        } else {
          setMessage(authMessage(res.code));
        }
        return;
      }
      setCurrent('');
      setNext('');
      setRepeat('');
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form panel narrow-form" onSubmit={submit} noValidate>
      {/* Für Passwort-Manager: zugehöriger Benutzername */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      {withCurrent && (
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
        <p className="error" role="alert">
          {message}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Speichern …' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Konto: Passwort ändern (Anforderung 1.7, 1.8). */
export function AccountPage() {
  const { session } = useAuth();
  const email = session?.user.email ?? '';
  const [done, setDone] = useState(false);

  return (
    <section>
      <div className="toolbar">
        <div>
          <span className="eyebrow">Konto</span>
          <h1>Passwort ändern</h1>
          <p className="muted">
            Angemeldet als <strong>{email}</strong>
          </p>
        </div>
      </div>
      {done && (
        <p className="success" role="status">
          Ihr Passwort wurde geändert. Andere angemeldete Geräte wurden abgemeldet.
        </p>
      )}
      <PasswordForm
        email={email}
        withCurrent
        submitLabel="Passwort ändern"
        onSubmit={(current, next) => {
          setDone(false);
          return auth!.changePassword(current, next);
        }}
        onDone={() => setDone(true)}
      />
    </section>
  );
}

/**
 * Passwort festlegen nach Einladung oder „Passwort vergessen“ (1.9). Wird vor allen anderen
 * Bereichen angezeigt; je nach Anbieter mit oder ohne bestehende Sitzung.
 */
export function SetPasswordPage({ type, onDone }: { type: PasswordLinkType; onDone: () => void }) {
  const { session } = useAuth();
  return (
    <main className="page narrow">
      <BrandMark size={40} />
      <span className="eyebrow">Konto</span>
      <h1>{type === 'invite' ? 'Willkommen' : 'Neues Passwort'}</h1>
      <p className="info">
        {type === 'invite'
          ? 'Legen Sie ein Passwort fest, damit Sie sich künftig anmelden können.'
          : 'Legen Sie ein neues Passwort fest.'}
      </p>
      <PasswordForm
        email={session?.user.email ?? ''}
        withCurrent={false}
        submitLabel="Passwort festlegen"
        onSubmit={(_current, next) => auth!.setPasswordFromLink(next)}
        onDone={onDone}
      />
    </main>
  );
}
