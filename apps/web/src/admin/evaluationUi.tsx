/** Gemeinsame Bausteine der Auswertung: Perspektivfarben, Formen, Zahlenformat, Skala 1–5. */
import { PERSPECTIVE_LABELS, PERSPECTIVES, type Perspective } from '@kb/shared';

/** Markenfarben der Perspektiven (identisch mit --persp-* in styles.css). */
export const PERSPECTIVE_COLORS: Record<Perspective, string> = {
  SELBST: '#ff6a3d',
  TEAM: '#15142b',
  FUEHRUNG: '#3f8f41',
};

/** Zweite Kodierung neben der Farbe, damit die Perspektive nie nur an der Farbe hängt. */
export const PERSPECTIVE_SHAPES: Record<Perspective, 'circle' | 'square' | 'diamond'> = {
  SELBST: 'circle',
  TEAM: 'square',
  FUEHRUNG: 'diamond',
};

export const fmt = (n: number) =>
  n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtSigned = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n));

/** Position auf der gemeinsamen Skala 1,00–5,00 in Prozent. */
export const scalePct = (score: number) => ((score - 1) / 4) * 100;

/** SVG-Form einer Perspektive, zentriert in (cx, cy). */
export function ShapeMark({
  perspective,
  cx = 7,
  cy = 7,
  r = 6,
}: {
  perspective: Perspective;
  cx?: number;
  cy?: number;
  r?: number;
}) {
  const fill = PERSPECTIVE_COLORS[perspective];
  const common = { fill, stroke: '#fff', strokeWidth: 2 };
  switch (PERSPECTIVE_SHAPES[perspective]) {
    case 'square':
      return (
        <rect
          x={cx - r * 0.85}
          y={cy - r * 0.85}
          width={r * 1.7}
          height={r * 1.7}
          rx={1.5}
          {...common}
        />
      );
    case 'diamond':
      return (
        <polygon
          points={`${cx},${cy - r * 1.15} ${cx + r * 1.15},${cy} ${cx},${cy + r * 1.15} ${cx - r * 1.15},${cy}`}
          {...common}
        />
      );
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} />;
  }
}

export function PerspectiveIcon({
  perspective,
  size = 14,
}: {
  perspective: Perspective;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="persp-icon">
      <ShapeMark perspective={perspective} />
    </svg>
  );
}

export function PerspectiveLegend() {
  return (
    <ul className="eval-legend" aria-label="Legende der Perspektiven">
      {PERSPECTIVES.map((p) => (
        <li key={p}>
          <PerspectiveIcon perspective={p} />
          {PERSPECTIVE_LABELS[p]}
        </li>
      ))}
    </ul>
  );
}

/** Achsenbeschriftung 1–5 der gemeinsamen Skala. */
export function ScaleAxis() {
  return (
    <div className="scale-axis" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((t) => (
        <span key={t} style={{ left: `${scalePct(t)}%` }}>
          {t}
        </span>
      ))}
    </div>
  );
}
