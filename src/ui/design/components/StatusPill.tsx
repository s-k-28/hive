import React from 'react';

const TONE: Record<string, string> = {
  planner: 'var(--d-amber)',
  worker: 'var(--d-live)',
  critic: 'var(--d-mag)',
  assembler: 'var(--d-grn)',
  amber: 'var(--d-amber)',
  cyan: 'var(--d-live)',
  magenta: 'var(--d-mag)',
  green: 'var(--d-grn)',
  red: 'var(--d-red)',
  neutral: 'var(--d-faint)',
};

/**
 * HIVE StatusPill. A small mono uppercase pill tinted by a semantic tone. Use
 * for mission status (Running, Awaiting you), task verdicts, and roles.
 */
export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: string;
  dot?: boolean;
}

export function StatusPill({ tone = 'amber', dot = true, className = '', children, ...rest }: StatusPillProps) {
  const color = TONE[tone] || tone;
  return (
    <span
      className={['hv-pill', className].filter(Boolean).join(' ')}
      style={{ '--pill': color } as React.CSSProperties}
      {...rest}
    >
      {dot && <span className="hv-pill-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
