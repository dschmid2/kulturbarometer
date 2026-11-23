import type { ButtonHTMLAttributes } from 'react';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Beschriftung für Tooltip und Screenreader. */
  label: string;
  icon: 'edit' | 'delete';
};

/** Runder Symbol-Button: Bleistift zum Bearbeiten, Papierkorb zum Löschen. */
export function IconButton({
  label,
  icon,
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={`icon-button ${icon === 'delete' ? 'icon-delete' : ''} ${className}`.trim()}
      aria-label={label}
      title={label}
      {...rest}
    >
      {icon === 'edit' ? <PencilIcon /> : <TrashIcon />}
    </button>
  );
}
