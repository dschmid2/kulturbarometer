/** Bildzeichen im Stil von kulturarchitekt.ch: Quadrat, Kreis, Quadrat, transparentes Quadrat. */
export function BrandMark({ size = 27 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 27 27" aria-hidden="true" className="brand-mark">
      <rect width="12" height="12" fill="#FF6A3D" />
      <circle cx="21" cy="6" r="6" fill="#D4F53C" />
      <rect y="15" width="12" height="12" fill="#fff" />
      <rect x="15" y="15" width="12" height="12" fill="#FF6A3D" fillOpacity=".55" />
    </svg>
  );
}

/** Schriftzug mit Untertitel „by kulturarchitekt.ch“. */
export function Wordmark() {
  return (
    <span className="wordmark">
      <BrandMark />
      <span className="wordmark-text">
        <span className="wordmark-title">Wertebarometer</span>
        <span className="wordmark-sub">by kulturarchitekt.ch</span>
      </span>
    </span>
  );
}
