import { ITEM_TYPE_LABELS, type ItemType, type Perspective } from '@kb/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Wordmark } from '../BrandMark';
import { ApiError, apiFetch } from '../lib/api';

interface SurveyItem {
  id: string;
  text: string;
  itemType: ItemType;
  perspective: Perspective;
}

type OpenResult =
  | { state: 'OK'; campaignId: string; title: string; items: SurveyItem[]; poolSize: number }
  | { state: 'UNAVAILABLE' }
  | { state: 'ALREADY_PARTICIPATED' };

type SubmitResult = { state: 'SUBMITTED' | 'UNAVAILABLE' | 'ALREADY_PARTICIPATED' };

type View =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'unavailable' }
  | { kind: 'already' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }
  | { kind: 'survey'; campaignId: string; title: string; items: SurveyItem[]; poolSize: number };

/** Perspektive als Kontext der Formulierung (8.2). */
const PERSPECTIVE_CONTEXT: Record<Perspective, string> = {
  SELBST: 'Über mich',
  TEAM: 'Über mein Team',
  FUEHRUNG: 'Über meine Führung',
};

// ---------------------------------------------------------------------------
// Teilnahmekennung (7.3, 7.4, 7.14): zufälliger Code im Local Storage und als Cookie
// ---------------------------------------------------------------------------

const CODE_KEY = 'kb-teilnahme';
const COOKIE = 'kb_teilnahme';

function readCookie(): string | null {
  const m = new RegExp(`(?:^|; )${COOKIE}=([^;]+)`).exec(document.cookie);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Liefert die Teilnahmekennung dieses Browsers und hält Local Storage und Cookie synchron. */
function participantCode(): string {
  let code: string | null = null;
  try {
    code = localStorage.getItem(CODE_KEY);
  } catch {
    /* Local Storage gesperrt: Cookie genügt */
  }
  code ??= readCookie();
  code ??= `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  try {
    localStorage.setItem(CODE_KEY, code);
  } catch {
    /* ignorieren */
  }
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${encodeURIComponent(code)}; Max-Age=${60 * 60 * 24 * 400}; Path=/umfrage; SameSite=Lax${secure}`;
  return code;
}

// ---------------------------------------------------------------------------
// Zwischenstand nur im Browser (8.13, 8.14)
// ---------------------------------------------------------------------------

interface Draft {
  ratings: Record<string, number>;
  comments: Record<string, string>;
}

const draftKey = (campaignId: string) => `kb-umfrage-${campaignId}`;

function loadDraft(campaignId: string): Draft {
  try {
    const raw = localStorage.getItem(draftKey(campaignId));
    if (raw) return JSON.parse(raw) as Draft;
  } catch {
    /* kein Zwischenstand */
  }
  return { ratings: {}, comments: {} };
}

function saveDraft(campaignId: string, draft: Draft) {
  try {
    localStorage.setItem(draftKey(campaignId), JSON.stringify(draft));
  } catch {
    /* Speichern nicht möglich – die Umfrage funktioniert trotzdem */
  }
}

function clearDraft(campaignId: string) {
  try {
    localStorage.removeItem(draftKey(campaignId));
  } catch {
    /* ignorieren */
  }
}

// ---------------------------------------------------------------------------
// Seite
// ---------------------------------------------------------------------------

/** Anonyme Teilnahme über den öffentlichen Kampagnen-Link (Anforderung 7 und 8). */
export function SurveyPage() {
  const { linkToken = '' } = useParams();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const code = useMemo(() => participantCode(), []);

  const open = useCallback(async () => {
    try {
      const r = await apiFetch<OpenResult>(`/public/survey/${linkToken}/open`, {
        method: 'POST',
        body: { code },
      });
      if (r.state === 'OK') {
        setView({
          kind: 'survey',
          campaignId: r.campaignId,
          title: r.title,
          items: r.items,
          poolSize: r.poolSize,
        });
      } else setView({ kind: r.state === 'UNAVAILABLE' ? 'unavailable' : 'already' });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_LINK') setView({ kind: 'invalid' });
      else setView({ kind: 'error', message: 'Die Umfrage konnte nicht geladen werden.' });
    }
  }, [linkToken, code]);

  useEffect(() => {
    void open();
  }, [open]);

  return (
    <div className="survey">
      <header className="survey-header">
        <Wordmark />
      </header>
      <main className="survey-main">
        {view.kind === 'loading' && <p className="muted">Umfrage wird geladen …</p>}
        {view.kind === 'invalid' && (
          <Notice title="Ungültiger Link">
            Dieser Umfrage-Link ist ungültig oder wurde ersetzt. Bitte verwenden Sie den aktuellen
            Link, den Sie erhalten haben.
          </Notice>
        )}
        {view.kind === 'unavailable' && (
          <Notice title="Umfrage nicht verfügbar">Die Umfrage ist derzeit nicht verfügbar.</Notice>
        )}
        {view.kind === 'already' && (
          <Notice title="Bereits teilgenommen">
            Sie haben an dieser Umfrage bereits teilgenommen. Vielen Dank für Ihre Antworten!
          </Notice>
        )}
        {view.kind === 'done' && (
          <Notice title="Vielen Dank!">
            Ihre Antworten wurden anonym gespeichert. Sie können dieses Fenster jetzt schliessen.
          </Notice>
        )}
        {view.kind === 'error' && <Notice title="Fehler">{view.message}</Notice>}
        {view.kind === 'survey' && (
          <SurveyForm
            token={linkToken}
            code={code}
            campaignId={view.campaignId}
            title={view.title}
            items={view.items}
            poolSize={view.poolSize}
            onDone={() => setView({ kind: 'done' })}
            onState={(s) => setView({ kind: s === 'UNAVAILABLE' ? 'unavailable' : 'already' })}
            onReload={open}
          />
        )}
      </main>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="survey-notice panel" role="status">
      <h1>{title}</h1>
      <p>{children}</p>
    </section>
  );
}

function SurveyForm({
  token,
  code,
  campaignId,
  title,
  items,
  poolSize,
  onDone,
  onState,
  onReload,
}: {
  token: string;
  code: string;
  campaignId: string;
  title: string;
  items: SurveyItem[];
  poolSize: number;
  onDone: () => void;
  onState: (s: 'UNAVAILABLE' | 'ALREADY_PARTICIPATED') => void;
  onReload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => loadDraft(campaignId));
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => saveDraft(campaignId, draft), [campaignId, draft]);

  const rated = items.filter((i) => draft.ratings[i.id] !== undefined).length;

  const setRating = (id: string, value: number) => {
    setDraft((d) => ({ ...d, ratings: { ...d.ratings, [id]: value } }));
    setMissing((m) => {
      if (!m.has(id)) return m;
      const n = new Set(m);
      n.delete(id);
      return n;
    });
  };
  const setComment = (id: string, text: string) =>
    setDraft((d) => ({ ...d, comments: { ...d.comments, [id]: text } }));

  const focusFirst = (ids: Set<string>) => {
    const first = items.find((i) => ids.has(i.id));
    if (first)
      cardRefs.current.get(first.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const notRated = new Set(
      items.filter((i) => draft.ratings[i.id] === undefined).map((i) => i.id),
    );
    if (notRated.size > 0) {
      setMissing(notRated);
      setError(
        `Bitte bewerten Sie noch ${notRated.size === 1 ? 'eine Frage' : `${notRated.size} Fragen`}.`,
      );
      focusFirst(notRated);
      return;
    }
    setBusy(true);
    try {
      const answers = items.map((i) => ({
        snapshotItemId: i.id,
        rating: draft.ratings[i.id]!,
        ...(draft.comments[i.id]?.trim() ? { comment: draft.comments[i.id]!.trim() } : {}),
      }));
      const r = await apiFetch<SubmitResult>(`/public/survey/${token}/submit`, {
        method: 'POST',
        body: { code, answers },
      });
      if (r.state === 'SUBMITTED') {
        clearDraft(campaignId);
        onDone();
      } else {
        if (r.state === 'ALREADY_PARTICIPATED') clearDraft(campaignId);
        onState(r.state);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MISSING_RATINGS') {
        const ids = new Set(err.fieldErrors.missing ?? []);
        setMissing(ids);
        setError(err.message);
        focusFirst(ids);
      } else if (err instanceof ApiError && err.code === 'VALIDATION') {
        // Feldpfade wie „answers.3.rating“ einer Frage zuordnen (8.4)
        const ids = new Set(
          Object.keys(err.fieldErrors)
            .map((k) => /^answers\.(\d+)\./.exec(k)?.[1])
            .filter((x): x is string => x !== undefined)
            .map((idx) => items[Number(idx)]?.id)
            .filter((x): x is string => !!x),
        );
        setInvalid(ids);
        setError('Bitte prüfen Sie die markierten Fragen: zulässig sind Werte von 1,00 bis 5,00.');
        focusFirst(ids);
      } else if (err instanceof ApiError && err.code === 'SESSION_MISSING') {
        await onReload();
      } else if (err instanceof ApiError && err.code === 'INVALID_LINK') {
        setError('Dieser Umfrage-Link ist nicht mehr gültig. Ihre Eingaben bleiben gespeichert.');
      } else {
        setError('Die Antworten konnten nicht gesendet werden. Bitte versuchen Sie es erneut.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <section className="survey-intro">
        <span className="eyebrow">Umfrage</span>
        <h1>{title}</h1>
        <p>
          Wie stark werden unsere Werte im Alltag gelebt? Bewerten Sie jede Aussage auf der Skala
          von <strong>1 – trifft gar nicht zu</strong> bis <strong>5 – trifft voll zu</strong>.
          Zwischenwerte sind möglich.
        </p>
        <p className="survey-selection">
          {items.length < poolSize ? (
            <>
              Sie erhalten eine <strong>zufällige Auswahl von {items.length}</strong> der {poolSize}{' '}
              verfügbaren Fragen – ausgewogen über alle Werte und Perspektiven. Andere Teilnehmende
              erhalten eine andere Auswahl.
            </>
          ) : (
            <>
              Sie beantworten alle <strong>{items.length} Fragen</strong> dieser Umfrage.
            </>
          )}
        </p>
        <p className="muted small">
          Die Umfrage ist anonym: Es werden weder Name noch E-Mail- oder IP-Adresse gespeichert. Ihr
          Zwischenstand bleibt nur in diesem Browser, bis Sie absenden.
        </p>
      </section>

      <div className="survey-progress" aria-live="polite">
        <div className="survey-progress-bar">
          <span style={{ width: `${(rated / items.length) * 100}%` }} />
        </div>
        <span className="small">
          {rated} von {items.length} bewertet
        </span>
      </div>

      <ol className="survey-items">
        {items.map((item, idx) => (
          <li
            key={item.id}
            ref={(el) => {
              if (el) cardRefs.current.set(item.id, el);
            }}
            className={`survey-item panel${missing.has(item.id) || invalid.has(item.id) ? ' survey-item-missing' : ''}`}
          >
            <div className="survey-item-head">
              <span className="survey-item-no">{idx + 1}</span>
              <span className={`badge persp-${item.perspective}`}>
                {PERSPECTIVE_CONTEXT[item.perspective]}
              </span>
              <span className="badge">{ITEM_TYPE_LABELS[item.itemType]}</span>
            </div>
            <p className="survey-item-text" id={`q-${item.id}`}>
              {item.text}
            </p>
            <RatingSlider
              labelledBy={`q-${item.id}`}
              value={draft.ratings[item.id]}
              onChange={(v) => setRating(item.id, v)}
            />
            {missing.has(item.id) && (
              <p className="field-error">Bitte bewerten Sie diese Aussage.</p>
            )}
            {invalid.has(item.id) && (
              <p className="field-error">Zulässig sind Werte von 1,00 bis 5,00.</p>
            )}
            <CommentField
              value={draft.comments[item.id] ?? ''}
              onChange={(t) => setComment(item.id, t)}
            />
          </li>
        ))}
      </ol>

      <div className="survey-submit panel">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Senden …' : 'Antworten absenden'}
        </button>
        <p className="muted small">Nach dem Absenden sind keine Änderungen mehr möglich.</p>
      </div>
    </form>
  );
}

/**
 * Stufenloser Schieberegler 1,00–5,00 ohne vorausgewählten Wert (8.2, 8.15, 8.16): Erst die
 * aktive Bedienung (Maus, Touch oder Tastatur) setzt einen Wert; der Wert wird mit zwei
 * Nachkommastellen angezeigt.
 */
function RatingSlider({
  value,
  onChange,
  labelledBy,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  labelledBy: string;
}) {
  const touched = value !== undefined;
  const commit = (raw: string) => onChange(Math.round(Number(raw) * 100) / 100);
  return (
    <div className={`rating${touched ? '' : ' rating-untouched'}`}>
      <div className="rating-row">
        <input
          type="range"
          min={1}
          max={5}
          step={0.01}
          value={value ?? 3}
          aria-labelledby={labelledBy}
          aria-valuetext={touched ? value!.toFixed(2) : 'noch nicht bewertet'}
          onChange={(e) => commit(e.target.value)}
          // Ein Klick genau auf die Mitte löst kein change-Ereignis aus – trotzdem als Bewertung zählen
          onPointerUp={(e) => !touched && commit(e.currentTarget.value)}
          onKeyUp={(e) => !touched && e.key.startsWith('Arrow') && commit(e.currentTarget.value)}
        />
        <output className="rating-value" aria-hidden="true">
          {touched ? value!.toFixed(2) : '–'}
        </output>
      </div>
      <div className="rating-scale" aria-hidden="true">
        <span>1 · trifft gar nicht zu</span>
        <span>5 · trifft voll zu</span>
      </div>
    </div>
  );
}

/** Optionaler Kommentar bis 1000 Zeichen mit Hinweis zur Anonymität (8.3). */
function CommentField({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const [open, setOpen] = useState(value !== '');
  if (!open) {
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        + Kommentar hinzufügen (optional)
      </button>
    );
  }
  return (
    <label className="survey-comment">
      Kommentar (optional)
      <textarea
        value={value}
        maxLength={1000}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="muted small">
        Bitte keine Namen oder Angaben, an denen Sie oder andere Personen erkennbar sind. ·{' '}
        {value.length}/1000
      </span>
    </label>
  );
}
