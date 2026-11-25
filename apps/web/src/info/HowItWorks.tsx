import { marked } from 'marked';
import { Link } from 'react-router-dom';
import doc from '../../../../docs/wertebarometer.md?raw';
import { Wordmark } from '../BrandMark';

// Einzige Quelle: docs/wertebarometer.md (auch für die kulturarchitekt.ch-Website)
const html = marked.parse(doc, { async: false });

/** Beschreibung von Zweck und Ablauf des Wertebarometers. */
export function HowItWorksArticle() {
  return <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Öffentliche Seite „So funktioniert's“ (ohne Anmeldung erreichbar). */
export function InfoPage() {
  return (
    <div className="survey">
      <header className="survey-header info-header">
        <Link to="/admin" className="wordmark" aria-label="Wertebarometer – zur Anmeldung">
          <Wordmark />
        </Link>
        <Link to="/admin" className="info-back">
          Zur Anmeldung
        </Link>
      </header>
      <main className="page">
        <HowItWorksArticle />
      </main>
    </div>
  );
}
