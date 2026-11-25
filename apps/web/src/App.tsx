import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './admin/AdminLayout';
import { InfoPage } from './info/HowItWorks';
import { SurveyPage } from './survey/SurveyPage';

/**
 * Getrennte Bereiche: Administration unter /admin, anonyme Teilnahme unter /umfrage (1.4),
 * öffentliche Beschreibung unter /so-funktionierts. */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin/*" element={<AdminLayout />} />
      <Route path="/umfrage/:linkToken" element={<SurveyPage />} />
      <Route path="/so-funktionierts" element={<InfoPage />} />
      <Route path="*" element={<p className="page">Seite nicht gefunden.</p>} />
    </Routes>
  );
}
