import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Avatar } from '../Avatar';
import { useAuth } from './auth';
import { useWorkspace } from './workspace';

/** Benutzermenü: Avatar mit Untermenü für Benutzer, Unternehmungen (je nach Berechtigung) und Abmelden. */
export function UserMenu() {
  const { signOut, session } = useAuth();
  const { me, hasRole } = useWorkspace();
  const email = me.email ?? session?.user.email ?? null;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Schliessen bei Klick ausserhalb und mit Escape
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Benutzermenü für ${email ?? 'Ihr Konto'}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar email={email} size={34} />
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" className="chevron">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" />
        </svg>
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-head">
            <Avatar email={email} size={40} />
            <div>
              <strong>{email}</strong>
              {me.platformAdmin && <span className="muted small">Plattform-Administrator</span>}
            </div>
          </div>
          {hasRole('ADMIN') && (
            <NavLink to="/admin/benutzer" role="menuitem" onClick={close}>
              Benutzer
            </NavLink>
          )}
          {me.platformAdmin && (
            <NavLink to="/admin/unternehmungen" role="menuitem" onClick={close}>
              Unternehmungen
            </NavLink>
          )}
          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => {
              close();
              void signOut();
            }}
          >
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}
