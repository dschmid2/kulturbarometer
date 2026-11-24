import {
  CAMPAIGN_STATUS_LABELS,
  DISTRIBUTION_CLASS_LABELS,
  PERSPECTIVE_GAP_HIGHLIGHT,
  PERSPECTIVE_LABELS,
  PERSPECTIVES,
  type CampaignEvaluation,
  type CampaignStatus,
  type Perspective,
  type PerspectiveCell,
  type PerspectiveGaps,
  type ValueEvaluation,
} from '@kb/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from '../lib/api';
import { formatDate } from './CampaignsPage';
import {
  fmt,
  fmtSigned,
  PERSPECTIVE_COLORS,
  PerspectiveIcon,
  PerspectiveLegend,
  ScaleAxis,
  scalePct,
} from './evaluationUi';
import { firstError } from './ValuesPage';

interface EvaluationResponse {
  campaign: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    status: CampaignStatus;
    anonymityThreshold: number;
  };
  evaluation: CampaignEvaluation;
}

/** Auswertung einer Kampagne auf Ebene der Werte und Perspektiven (Anforderung 10). */
export function EvaluationPage() {
  const { id = '' } = useParams();
  const q = useQuery({
    queryKey: ['evaluation', id],
    queryFn: () => apiFetch<EvaluationResponse>(`/admin/campaigns/${id}/evaluation`),
  });
  if (q.isLoading) return <p className="muted">Laden …</p>;
  if (q.error || !q.data) return <p className="error">{firstError(q.error)}</p>;
  const { campaign: c, evaluation: ev } = q.data;

  return (
    <section className="evaluation">
      <p className="small">
        <Link to={`/admin/kampagnen/${c.id}`}>← Zur Kampagne</Link> ·{' '}
        <Link to="/admin/auswertung">Alle Auswertungen</Link>
      </p>
      <div className="toolbar">
        <div>
          <span className="eyebrow">Auswertung</span>
          <h1>{c.title}</h1>
          <p className="muted">
            {formatDate(c.startDate)} – {formatDate(c.endDate)} ·{' '}
            <span className={`badge campaign-${c.status}`}>{CAMPAIGN_STATUS_LABELS[c.status]}</span>
          </p>
        </div>
      </div>
      <EvaluationBody ev={ev} />
    </section>
  );
}

function EvaluationBody({ ev }: { ev: CampaignEvaluation }) {
  switch (ev.state) {
    case 'ENTWURF':
      return (
        <p className="empty">
          Die Kampagne ist noch ein Entwurf. Eine Auswertung ist erst nach der Aktivierung
          verfügbar.
        </p>
      );
    case 'KEINE_ANTWORTEN':
      return <p className="empty">Es liegen noch keine Antworten vor.</p>;
    case 'UNTER_SCHWELLE':
      return (
        <div className="empty">
          <h2>Noch zu wenige Antworten</h2>
          <p>
            Abgegeben: <strong>{ev.totalParticipations}</strong> · Anonymitätsschwelle:{' '}
            <strong>{ev.threshold}</strong>. Zum Schutz der Anonymität ist die Auswertung erst ab
            Erreichen der Schwelle verfügbar.
          </p>
        </div>
      );
  }

  return (
    <>
      {ev.provisional ? (
        <p className="info">
          <strong>Vorläufige Zwischenauswertung.</strong> Einbezogen sind{' '}
          {ev.includedParticipations} von {ev.totalParticipations} abgegebenen Antworten – die
          Auswertung wächst in Schritten der Anonymitätsschwelle ({ev.threshold}), damit einzelne
          Antworten nicht erkennbar werden.
        </p>
      ) : (
        <p className="info">
          <strong>Endauswertung</strong> mit {ev.includedParticipations} Antworten ·
          Anonymitätsschwelle {ev.threshold}
        </p>
      )}
      {ev.noData ? (
        <p className="empty">Keine Daten: Keine Bewertung trägt zu einem Unternehmenswert bei.</p>
      ) : (
        <>
          <Overview values={ev.values} />
          {ev.values.map((v) => (
            <ValueDetail key={v.valueId} value={v} threshold={ev.threshold} />
          ))}
        </>
      )}
      <div className="panel">
        <h2>Deaktivierte Fragen</h2>
        {ev.deactivatedItems.length === 0 ? (
          <p className="muted">In dieser Kampagne wurden keine Fragen deaktiviert.</p>
        ) : (
          <ul className="pool-list">
            {ev.deactivatedItems.map((d) => (
              <li key={d.snapshotItemId}>
                <span className="pool-text">{d.text}</span>
                <span className="muted small">
                  deaktiviert am {new Date(d.deactivatedAt).toLocaleString('de-CH')} ·{' '}
                  {d.excludedRatings} Bewertungen ausgeschlossen
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

const shownScore = (cell: PerspectiveCell) => (cell.shown ? cell.istScore : null);
const hiddenText = (cell: PerspectiveCell) =>
  cell.shown ? '' : cell.reason === 'ZU_WENIGE_ANTWORTEN' ? 'zu wenige Antworten' : 'keine Daten';

/** Übersicht aller Werte: drei Perspektiven je Wert auf der gemeinsamen Skala 1–5 (10.18). */
function Overview({ values }: { values: ValueEvaluation[] }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Alle Werte im Überblick</h2>
        <PerspectiveLegend />
      </div>
      <p className="muted small">
        Ist-Score je Perspektive auf der Skala 1 (trifft nicht zu) bis 5 (trifft voll zu), sortiert
        nach der Selbsteinschätzung.
      </p>
      <div className="dotplot" role="img" aria-label="Ist-Scores aller Werte je Perspektive">
        {values.map((v) => (
          <div className="dotplot-row" key={v.valueId}>
            <a className="dotplot-label" href={`#wert-${v.valueId}`}>
              {v.name}
            </a>
            <div className="dotplot-track">
              {[1, 2, 3, 4, 5].map((t) => (
                <span key={t} className="dotplot-grid" style={{ left: `${scalePct(t)}%` }} />
              ))}
              {PERSPECTIVES.map((p) => {
                const s = shownScore(v.perspectives[p]);
                if (s === null) return null;
                return (
                  <span
                    key={p}
                    className="dotplot-mark"
                    style={{ left: `${scalePct(s)}%` }}
                    tabIndex={0}
                    data-tip={`${v.name} · ${PERSPECTIVE_LABELS[p]}: ${fmt(s)}`}
                  >
                    <PerspectiveIcon perspective={p} size={16} />
                  </span>
                );
              })}
            </div>
          </div>
        ))}
        <div className="dotplot-row">
          <span />
          <ScaleAxis />
        </div>
      </div>
      <details className="table-alt">
        <summary>Als Tabelle anzeigen</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Wert</th>
              {PERSPECTIVES.map((p) => (
                <th scope="col" key={p}>
                  {PERSPECTIVE_LABELS[p]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {values.map((v) => (
              <tr key={v.valueId}>
                <th scope="row">{v.name}</th>
                {PERSPECTIVES.map((p) => {
                  const cell = v.perspectives[p];
                  return <td key={p}>{cell.shown ? fmt(cell.istScore) : hiddenText(cell)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

const GAP_LABELS: [keyof PerspectiveGaps, string][] = [
  ['selbstTeam', 'Selbst – Team'],
  ['selbstFuehrung', 'Selbst – Führung'],
  ['teamFuehrung', 'Team – Führung'],
];

/** Detail je Wert: Kennzahlen und Verteilung der drei Perspektiven, Differenzen, Kommentare. */
function ValueDetail({ value: v, threshold }: { value: ValueEvaluation; threshold: number }) {
  // Gleiche y-Skala für die drei Verteilungen eines Werts (10.16)
  const maxShare = Math.max(
    10,
    ...PERSPECTIVES.flatMap((p) => {
      const c = v.perspectives[p];
      return c.shown ? c.distribution.classShares : [];
    }),
  );
  const yMax = Math.ceil(maxShare / 10) * 10;

  return (
    <article className="panel value-eval" id={`wert-${v.valueId}`}>
      <h2>{v.name}</h2>
      <div className="persp-grid">
        {PERSPECTIVES.map((p) => (
          <PerspectiveTile key={p} perspective={p} cell={v.perspectives[p]} yMax={yMax} />
        ))}
      </div>
      <div className="gaps" aria-label="Perspektivdifferenzen">
        <span className="muted small">Differenzen</span>
        {GAP_LABELS.map(([key, label]) => {
          const g = v.gaps[key];
          const strong = g !== null && Math.abs(g) >= PERSPECTIVE_GAP_HIGHLIGHT;
          return (
            <span key={key} className={`gap-chip${strong ? ' gap-strong' : ''}`}>
              {label}: <strong>{g === null ? '–' : fmtSigned(g)}</strong>
              {strong && <span className="sr-only"> (deutliche Differenz)</span>}
            </span>
          );
        })}
      </div>
      <details className="table-alt">
        <summary>Kennzahlen als Tabelle</summary>
        <DistributionTable value={v} />
      </details>
      {v.comments.shown ? (
        <details className="comments">
          <summary>Kommentare ({v.comments.items.length})</summary>
          {v.comments.items.length === 0 ? (
            <p className="muted small">Keine Kommentare.</p>
          ) : (
            <ul>
              {v.comments.items.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          )}
        </details>
      ) : (
        <p className="muted small">Kommentare: zu wenige Antworten (Schwelle {threshold}).</p>
      )}
    </article>
  );
}

function PerspectiveTile({
  perspective: p,
  cell,
  yMax,
}: {
  perspective: Perspective;
  cell: PerspectiveCell;
  yMax: number;
}) {
  return (
    <div className="persp-tile">
      <div className="persp-tile-head">
        <PerspectiveIcon perspective={p} />
        <span>{PERSPECTIVE_LABELS[p]}</span>
      </div>
      {cell.shown ? (
        <>
          <div className="persp-score">{fmt(cell.istScore)}</div>
          <p className="muted small">
            {cell.ratingCount} Bewertungen · {cell.contributors} Personen
            <br />
            Median {fmt(cell.distribution.median)} · Streuung {fmt(cell.distribution.stdDev)}
          </p>
          <DistributionChart perspective={p} cell={cell} yMax={yMax} />
        </>
      ) : (
        <p className="persp-hidden">{hiddenText(cell)}</p>
      )}
    </div>
  );
}

const CLASS_TICKS = ['1–1,8', '1,8–2,6', '2,6–3,4', '3,4–4,2', '4,2–5'];

function DistributionChart({
  perspective,
  cell,
  yMax,
}: {
  perspective: Perspective;
  cell: Extract<PerspectiveCell, { shown: true }>;
  yMax: number;
}) {
  const data = cell.distribution.classShares.map((share, i) => ({
    name: CLASS_TICKS[i],
    label: DISTRIBUTION_CLASS_LABELS[i],
    share,
    count: cell.distribution.classCounts[i],
  }));
  return (
    <div className="dist-chart" aria-hidden="true">
      <ResponsiveContainer width="100%" height={150}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 4, bottom: 0, left: -18 }}
          barCategoryGap={4}
        >
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: 'rgba(21,20,43,0.6)' }}
            tickLine={false}
            axisLine={{ stroke: 'rgba(21,20,43,0.2)' }}
            interval={0}
          />
          <YAxis
            domain={[0, yMax]}
            tickCount={3}
            tick={{ fontSize: 10, fill: 'rgba(21,20,43,0.6)' }}
            tickFormatter={(v: number) => `${v}%`}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(21,20,43,0.06)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]!.payload as (typeof data)[number];
              return (
                <div className="chart-tip">
                  <strong>{d.label}</strong>
                  <br />
                  {d.count} {d.count === 1 ? 'Person' : 'Personen'} · {d.share} %
                </div>
              );
            }}
          />
          <Bar dataKey="share" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={PERSPECTIVE_COLORS[perspective]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DistributionTable({ value: v }: { value: ValueEvaluation }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">Perspektive</th>
          <th scope="col">Ist-Score</th>
          <th scope="col">Bewertungen</th>
          <th scope="col">Personen</th>
          <th scope="col">Median</th>
          <th scope="col">Streuung</th>
          {DISTRIBUTION_CLASS_LABELS.map((l) => (
            <th scope="col" key={l}>
              {l}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {PERSPECTIVES.map((p) => {
          const c = v.perspectives[p];
          return (
            <tr key={p}>
              <th scope="row">{PERSPECTIVE_LABELS[p]}</th>
              {c.shown ? (
                <>
                  <td>{fmt(c.istScore)}</td>
                  <td>{c.ratingCount}</td>
                  <td>{c.contributors}</td>
                  <td>{fmt(c.distribution.median)}</td>
                  <td>{fmt(c.distribution.stdDev)}</td>
                  {c.distribution.classCounts.map((n, i) => (
                    <td key={i}>
                      {n} ({c.distribution.classShares[i]} %)
                    </td>
                  ))}
                </>
              ) : (
                <td colSpan={10}>{hiddenText(c)}</td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
