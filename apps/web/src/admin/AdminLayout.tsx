import type { Role } from '@kb/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Wordmark } from '../BrandMark';
import { HowItWorksArticle } from '../info/HowItWorks';
import { apiFetch } from '../lib/api';
import { auth } from '../lib/auth';
import { AccountPage, SetPasswordPage } from './AccountPage';
import { AuthProvider, useAuth } from './auth';
import { CampaignDetailPage } from './CampaignDetailPage';
import { CampaignsPage } from './CampaignsPage';
import { EvaluationPage } from './EvaluationPage';
import { ItemsPage } from './ItemsPage';
import { LoginPage } from './LoginPage';
import { MembersPage } from './MembersPage';
import { OrganizationsPage } from './OrganizationsPage';
import { TrendsPage } from './TrendsPage';
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
  // Einladungs- oder Wiederherstellungslink: zuerst ein Passwort festlegen (1.9).
  const [link, setLink] = useState(() => auth?.pendingPasswordLink() ?? null);
  if (loading) return <p className="page muted">Laden …</p>;
  if (link) {
    return (
      <SetPasswordPage
        type={link}
        onDone={() => {
          if (!session) {
            sessionStorage.setItem(
              'kb-login-notice',
              'Ihr Passwort ist festgelegt. Bitte melden Sie sich an.',
            );
          }
          setLink(null);
        }}
      />
    );
  }
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
  const location = useLocation();
  const onAccount = location.pathname.startsWith('/admin/konto');
  const onInfo = location.pathname.startsWith('/admin/so-funktionierts');
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
          aria-label="Wertebarometer – Startseite der Administration"
        >
          <Wordmark />
        </NavLink>
        <nav>
          {hasRole('WERTE') && <NavLink to="/admin/werte">Werte</NavLink>}
          {hasRole('WERTE') && <NavLink to="/admin/fragen">Fragen</NavLink>}
          {hasRole('KAMPAGNEN') && <NavLink to="/admin/kampagnen">Kampagnen</NavLink>}
          {hasRole('KAMPAGNEN') && <NavLink to="/admin/auswertung">Auswertung</NavLink>}
          <NavLink to="/admin/so-funktionierts">So funktioniert's</NavLink>
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
        {onAccount ? (
          <AccountPage />
        ) : onInfo ? (
          <HowItWorksArticle />
        ) : !org && !me.platformAdmin ? (
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
                  <CampaignsPage />
                </Guard>
              }
            />
            <Route
              path="kampagnen/:id"
              element={
                <Guard roles={['KAMPAGNEN']}>
                  <CampaignDetailPage />
                </Guard>
              }
            />
            <Route
              path="kampagnen/:id/auswertung"
              element={
                <Guard roles={['KAMPAGNEN']}>
                  <EvaluationPage />
                </Guard>
              }
            />
            <Route
              path="auswertung"
              element={
                <Guard roles={['KAMPAGNEN']}>
                  <TrendsPage />
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
