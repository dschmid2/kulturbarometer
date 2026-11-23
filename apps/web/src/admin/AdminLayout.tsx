import type { Role } from '@kb/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Wordmark } from '../BrandMark';
import { apiFetch } from '../lib/api';
import { AuthProvider, useAuth } from './auth';
import { ItemsPage } from './ItemsPage';
import { LoginPage } from './LoginPage';
import { MembersPage } from './MembersPage';
import { OrganizationsPage } from './OrganizationsPage';
import type { Me } from './types';
import { ValuesPage } from './ValuesPage';
import { UserMenu } from './UserMenu';
import { useWorkspace, WorkspaceProvider } from './workspace';

export function AdminLayout() {
  return (
    <AuthProvider>
      <AdminGate />
    </AuthProvider>
  );
}

/** Ohne gültige Sitzung wird nur die Anmeldeseite angezeigt (1.4). */
function AdminGate() {
  const { session, loading } = useAuth();
  if (loading) return <p className="page muted">Laden …</p>;
  if (!session) return <LoginPage />;
  return <MeLoader />;
}

/** Lädt Identität, Unternehmungen und Rollen; bei 401 wird abgemeldet. */
function MeLoader() {
  const { session } = useAuth();
  const me = useQuery({
    queryKey: ['me', session?.user.id],
    queryFn: () => apiFetch<Me>('/admin/me'),
  });
  if (me.isLoading) return <p className="page muted">Laden …</p>;
  if (me.error || !me.data) {
    return <p className="page error">{(me.error as Error)?.message ?? 'Fehler beim Laden.'}</p>;
  }
  return (
    <WorkspaceProvider me={me.data}>
      <AdminShell />
    </WorkspaceProvider>
  );
}

/** Zeigt eine Seite nur mit passender Rolle (12); sonst einen Hinweis. */
function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { hasRole } = useWorkspace();
  if (!hasRole(...roles)) {
    return <p className="empty">Für diesen Bereich fehlt Ihnen die nötige Rolle.</p>;
  }
  return <>{children}</>;
}

function AdminShell() {
  const { me, org, selectOrg, hasRole } = useWorkspace();
  const start = hasRole('WERTE')
    ? 'werte'
    : hasRole('KAMPAGNEN')
      ? 'kampagnen'
      : hasRole('ADMIN')
        ? 'benutzer'
        : me.platformAdmin
          ? 'unternehmungen'
          : null;

  return (
    <div className="admin">
      <header className="admin-header">
        <NavLink
          to="/admin"
          className="wordmark"
          aria-label="Kulturbarometer – Startseite der Administration"
        >
          <Wordmark />
        </NavLink>
        <nav>
          {hasRole('WERTE') && <NavLink to="/admin/werte">Werte</NavLink>}
          {hasRole('WERTE') && <NavLink to="/admin/fragen">Fragen</NavLink>}
          {hasRole('KAMPAGNEN') && <NavLink to="/admin/kampagnen">Kampagnen</NavLink>}
        </nav>
        <span className="spacer" />
        {me.organizations.length > 1 ? (
          <select
            className="org-select"
            value={org?.id ?? ''}
            onChange={(e) => selectOrg(e.target.value)}
            aria-label="Aktive Unternehmung"
          >
            {me.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        ) : (
          org && <span className="org-name">{org.name}</span>
        )}
        <UserMenu />
      </header>
      <main className="page" key={org?.id ?? 'none'}>
        {!org && !me.platformAdmin ? (
          <div className="empty">
            <h2>Noch keiner Unternehmung zugeordnet</h2>
            <p>
              Ihr Konto ist angemeldet, aber noch keiner Unternehmung zugeordnet. Bitten Sie eine
              Person mit der Rolle „Benutzer-Administration“, Sie hinzuzufügen.
            </p>
          </div>
        ) : (
          <Routes>
            <Route index element={start ? <Navigate to={start} replace /> : null} />
            <Route
              path="werte"
              element={
                <Guard roles={['WERTE']}>
                  <ValuesPage />
                </Guard>
              }
            />
            <Route
              path="fragen"
              element={
                <Guard roles={['WERTE']}>
                  <ItemsPage />
                </Guard>
              }
            />
            <Route path="items" element={<Navigate to="../fragen" replace />} />
            <Route
              path="benutzer"
              element={
                <Guard roles={['ADMIN']}>
                  <MembersPage />
                </Guard>
              }
            />
            <Route
              path="unternehmungen"
              element={
                me.platformAdmin ? (
                  <OrganizationsPage />
                ) : (
                  <p className="empty">Nur für Plattform-Administratoren.</p>
                )
              }
            />
            <Route
              path="kampagnen"
              element={
                <Guard roles={['KAMPAGNEN']}>
                  <p className="empty">Die Kampagnen folgen im nächsten Schritt.</p>
                </Guard>
              }
            />
            <Route path="*" element={<p className="muted">Seite nicht gefunden.</p>} />
          </Routes>
        )}
      </main>
    </div>
  );
}
