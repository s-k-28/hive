import React from 'react';

const TONE: Record<string, string> = {
  magenta: 'var(--d-mag)',
  amber: 'var(--d-amber)',
  red: 'var(--d-red)',
  cyan: 'var(--d-live)',
};

function Shield() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * HIVE GatePrompt. The "stop and ask" moment. A badge + title + body, with
 * action buttons passed as `actions`. `tone` colors the badge and halo
 * (magenta = risk, amber = budget/steps). Set `backdrop={false}` to render the
 * bare card without the blurred overlay.
 */
export interface GatePromptProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: string;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  backdrop?: boolean;
}

export function GatePrompt({ tone = 'magenta', title, icon, actions, backdrop = true, className = '', children, ...rest }: GatePromptProps) {
  const color = TONE[tone] || tone;
  const card = (
    <div className={['hv-gate', className].filter(Boolean).join(' ')} style={{ '--gate': color } as React.CSSProperties} {...rest}>
      <div className="hv-gate-head">
        <span className="hv-gate-badge" aria-hidden="true">
          {icon || <Shield />}
        </span>
        <h3 className="hv-gate-title">{title}</h3>
      </div>
      <div className="hv-gate-body">{children}</div>
      {actions && <div className="hv-gate-actions">{actions}</div>}
    </div>
  );
  if (!backdrop) return card;
  return <div className="hv-gate-wrap">{card}</div>;
}
