import {
  CAMPAIGN_STATUS_LABELS,
  PERSPECTIVE_LABELS,
  PERSPECTIVES,
  type Perspective,
  type TrendDirection,
  type TrendPoint,
  type TrendResult,
  type ValueTrend,
} from '@kb/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../lib/api';
import { formatDate } from './CampaignsPage';
import {
  fmt,
  PERSPECTIVE_COLORS,
  PerspectiveIcon,
  PerspectiveLegend,
  ShapeMark,
} from './evaluationUi';
import type { CampaignSummary } from './types';
import { firstError } from './ValuesPage';

const ARROWS: Record<TrendDirection, { sign: string; label: string }> = {
  STEIGT: { sign: '↑', label: 'gestiegen' },
  FAELLT: { sign: '↓', label: 'gesunken' },
  GLEICH: { sign: '→', label: 'unverändert' },
};

/** Einstieg in die Auswertung: Kampagnen und Entwicklung der Werte (Anforderung 10.4, 10.5). */
export function TrendsPage() {
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => apiFetch<CampaignSummary[]>('/admin/campaigns'),
  });
  const trends = useQuery({
    queryKey: ['trends'],
    queryFn: () => apiFetch<TrendResult>('/admin/evaluation/trends'),
  });
  const evaluable = (campaigns.data ?? []).filter((c) => c.status !== 'ENTWURF');

  return (
    <section className="evaluation">
      <div className="toolbar">
        <div>
          <span className="eyebrow">Reporting</span>
          <h1>Auswertung</h1>
          <p className="muted">
            Ergebnisse je Unternehmenswert und Perspektive. Einzelne Fragen werden nicht
            ausgewertet; Zahlen erscheinen erst ab der Anonymitätsschwelle.
          </p>
        </div>
      </div>

      <div className="panel">
        <h2>Kampagnen</h2>
        {campaigns.isLoading && <p className="muted">Laden …</p>}
        {campaigns.data && evaluable.length === 0 && (
          <p className="muted">Noch keine aktivierte Kampagne.</p>
        )}
        <ul className="pool-list">
          {evaluable.map((c) => (
            <li key={c.id}>
              <Link className="pool-text" to={`/admin/kampagnen/${c.id}/auswertung`}>
                {c.title}
              </Link>
              <span className="badges">
                <span className="muted small">
                  {formatDate(c.startDate)} – {formatDate(c.endDate)}
                </span>
                <span className={`badge campaign-${c.status}`}>
                  {c.status === 'AKTIV' ? 'Zwischenauswertung' : CAMPAIGN_STATUS_LABELS[c.status]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel-head">
        <h2>Entwicklung der Werte</h2>
        <PerspectiveLegend />
      </div>
      <p className="muted small">
        Ist-Score je Perspektive über die abgeschlossenen Kampagnen; die Achse ist auf den Bereich
        der Werte vergrössert. Lücken bedeuten: in dieser Kampagne zu wenige Antworten für die
        Perspektive.
      </p>
      {trends.isLoading && <p className="muted">Laden …</p>}
      {trends.error && <p className="error">{firstError(trends.error)}</p>}
      {trends.data && trends.data.campaigns.length === 0 && (
        <p className="empty">
          Noch keine abgeschlossene Kampagne – der Verlauf erscheint ab der ersten.
        </p>
      )}
      {trends.data && trends.data.campaigns.length > 0 && (
        <div className="trend-grid">
          {trends.data.values.map((v) => (
            <TrendCard key={v.valueId} value={v} campaigns={trends.data.campaigns} />
          ))}
        </div>
      )}
    </section>
  );
}

function TrendCard({
  value: v,
  campaigns,
}: {
  value: ValueTrend;
  campaigns: TrendResult['campaigns'];
}) {
  const data = campaigns.map((c, i) => {
    const row: Record<string, unknown> = {
      name: c.title.replace(/^(Kultur|Werte)barometer\s+/, ''),
    };
    for (const p of PERSPECTIVES) row[p] = v.points[i]![p]?.istScore ?? null;
    return row;
  });
  // y-Achse auf den Datenbereich (in Schritten von 0,5) zoomen, damit Veränderungen sichtbar sind
  const scores = v.points.flatMap((pt) =>
    PERSPECTIVES.flatMap((p) => (pt[p] ? [pt[p].istScore] : [])),
  );
  const yMin = Math.max(1, Math.floor((Math.min(...scores, 5) - 0.25) * 2) / 2);
  const yMax = Math.min(5, Math.ceil((Math.max(...scores, 1) + 0.25) * 2) / 2);
  const yTicks: number[] = [];
  for (let t = yMin; t <= yMax + 1e-9; t += 0.5) yTicks.push(t);
  const latest = (p: Perspective): TrendPoint | null => {
    for (let i = v.points.length - 1; i >= 0; i--) if (v.points[i]![p]) return v.points[i]![p];
    return null;
  };

  return (
    <article className="panel trend-card">
      <h3>{v.name}</h3>
      <ul className="trend-latest">
        {PERSPECTIVES.map((p) => {
          const pt = latest(p);
          return (
            <li key={p}>
              <PerspectiveIcon perspective={p} />
              <span className="muted small">{PERSPECTIVE_LABELS[p]}</span>
              <strong>{pt ? fmt(pt.istScore) : '–'}</strong>
              {pt?.direction && (
                <span
                  className={`trend-dir dir-${pt.direction}`}
                  title={ARROWS[pt.direction].label}
                >
                  {ARROWS[pt.direction].sign}
                  <span className="sr-only"> {ARROWS[pt.direction].label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="rgba(21,20,43,0.08)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: 'rgba(21,20,43,0.6)' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(21,20,43,0.2)' }}
              padding={{ left: 20, right: 20 }}
            />
            <YAxis
              domain={[yMin, yMax]}
              ticks={yTicks}
              tickFormatter={(t: number) => fmt(t)}
              tick={{ fontSize: 11, fill: 'rgba(21,20,43,0.6)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="chart-tip">
                    <strong>{label}</strong>
                    {PERSPECTIVES.map((p) => {
                      const val = payload.find((e) => e.dataKey === p)?.value as number | null;
                      return (
                        <div key={p}>
                          {PERSPECTIVE_LABELS[p]}: {val == null ? 'zu wenige Antworten' : fmt(val)}
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {PERSPECTIVES.map((p) => (
              <Line
                key={p}
                dataKey={p}
                stroke={PERSPECTIVE_COLORS[p]}
                strokeWidth={2}
                connectNulls={false}
                isAnimationActive={false}
                dot={(props: { cx?: number; cy?: number; index?: number; value?: unknown }) =>
                  props.cx == null || props.cy == null || props.value == null ? (
                    <g key={`${p}-${props.index}`} />
                  ) : (
                    <g key={`${p}-${props.index}`}>
                      <ShapeMark perspective={p} cx={props.cx} cy={props.cy} r={5} />
                    </g>
                  )
                }
                activeDot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="table-alt">
        <summary>Als Tabelle (mit Streuung)</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Perspektive</th>
              {campaigns.map((c) => (
                <th scope="col" key={c.id}>
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERSPECTIVES.map((p) => (
              <tr key={p}>
                <th scope="row">{PERSPECTIVE_LABELS[p]}</th>
                {v.points.map((pt, i) => {
                  const cell = pt[p];
                  return (
                    <td key={i}>
                      {cell ? (
                        <>
                          {fmt(cell.istScore)} <span className="muted">± {fmt(cell.stdDev)}</span>{' '}
                          {cell.direction && (
                            <span className={`trend-dir dir-${cell.direction}`}>
                              {ARROWS[cell.direction].sign}
                              <span className="sr-only"> {ARROWS[cell.direction].label}</span>
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="muted">zu wenige Antworten</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </article>
  );
}
