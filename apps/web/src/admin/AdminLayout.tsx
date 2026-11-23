import { NavLink, Route, Routes } from 'react-router-dom';
import { PERSPECTIVE_LABELS } from '@kb/shared';

export function AdminLayout() {
  return (
    <div className="admin">
      <header className="admin-header">
        <strong>Kulturbarometer</strong>
        <nav>
          <NavLink to="/admin/werte">Werte</NavLink>
          <NavLink to="/admin/items">Items</NavLink>
          <NavLink to="/admin/kampagnen">Kampagnen</NavLink>
        </nav>
      </header>
      <main className="page">
        <Routes>
          <Route
            index
            element={
              <p>
                Administration – Perspektiven: {Object.values(PERSPECTIVE_LABELS).join(', ')}. Die
                Bereiche folgen in den nächsten Aufgaben.
              </p>
            }
          />
          <Route path="*" element={<p>Dieser Bereich folgt in den nächsten Aufgaben.</p>} />
        </Routes>
      </main>
    </div>
  );
}
