import React from 'react';

const ROLE_COLOR: Record<string, string> = {
  planner: 'var(--d-amber)',
  worker: 'var(--d-live)',
  critic: 'var(--d-mag)',
  assembler: 'var(--d-grn)',
};

/**
 * HIVE AgentChip. One instrument light in the swarm roster. The square dot
 * carries the agent's role color and breathes while `visual="thinking"`.
 */
export interface AgentChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  name: string;
  role?: string;
  color?: string;
  visual?: string;
  focused?: boolean;
}

export function AgentChip({ name, role = 'worker', color, visual = 'idle', focused = false, className = '', ...rest }: AgentChipProps) {
  const dot = color || ROLE_COLOR[role] || 'var(--d-faint)';
  return (
    <button
      type="button"
      className={['hv-agent', className].filter(Boolean).join(' ')}
      data-visual={visual}
      data-focused={focused}
      {...rest}
    >
      <span className="hv-agent-dot" style={{ '--dot': dot } as React.CSSProperties} aria-hidden="true" />
      {name}
    </button>
  );
}
