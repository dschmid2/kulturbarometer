import { useQuery } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Wordmark } from '../BrandMark';
import { apiFetch } from '../lib/api';
import { AuthProvider, useAuth } from './auth';
import { ItemsPage } from './ItemsPage';
import { LoginPage } from './LoginPage';
import { ValuesPage } from './ValuesPage';

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
  return <AdminShell />;
}

function AdminShell() {
  const { signOut, session } = useAuth();
  // Prüft beim Backend, ob das Konto Administrator-Rechte hat; bei 401 wird abgemeldet.
  const me = useQuery({ queryKey: ['me', session?.user.id], queryFn: () => apiFetch('/admin/me') });

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
          <NavLink to="/admin/werte">Werte</NavLink>
          <NavLink to="/admin/items">Items</NavLink>
          <NavLink to="/admin/kampagnen">Kampagnen</NavLink>
        </nav>
        <span className="spacer" />
        <span className="user">{session?.user.email}</span>
        <button className="secondary small" onClick={() => void signOut()}>
          Abmelden
        </button>
      </header>
      <main className="page">
        {me.isLoading ? (
          <p className="muted">Laden …</p>
        ) : (
          <Routes>
            <Route index element={<Navigate to="werte" replace />} />
            <Route path="werte" element={<ValuesPage />} />
            <Route path="items" element={<ItemsPage />} />
            <Route
              path="*"
              element={<p className="muted">Dieser Bereich folgt in den nächsten Aufgaben.</p>}
            />
          </Routes>
        )}
      </main>
    </div>
  );
}
