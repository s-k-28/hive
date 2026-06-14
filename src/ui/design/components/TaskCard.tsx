import React from 'react';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  review: 'In review',
  rejected: 'Rejected',
  accepted: 'Accepted',
  failed: 'Failed',
  killed: 'Killed',
};

const fmtCost = (c: number) => `$${(Number(c) / 100).toFixed(2)}`;

/**
 * HIVE TaskCard. The signature glass card of the mission board. Drives its whole
 * treatment off `status` (running gets a cyan sheen + spinner, accepted goes
 * green, killed dims); `gated` adds the pulsing amber risk hold.
 */
export interface TaskCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  status?: string;
  costCents?: number;
  risk?: boolean;
  riskApproved?: boolean;
  gated?: boolean;
  attempts?: number;
  focused?: boolean;
}

export function TaskCard({
  title,
  status = 'pending',
  costCents = 0,
  risk = false,
  riskApproved = false,
  gated = false,
  attempts = 0,
  focused = false,
  className = '',
  ...rest
}: TaskCardProps) {
  return (
    <button
      type="button"
      className={['hv-task', className].filter(Boolean).join(' ')}
      data-status={status}
      data-gated={gated || undefined}
      data-focused={focused || undefined}
      aria-label={`${title}. ${STATUS_LABEL[status] ?? status}. Open inspector.`}
      {...rest}
    >
      <span className="hv-task-top">
        <span className="hv-task-dot" aria-hidden="true">
          {status === 'running' ? <span className="hv-task-spin" /> : null}
        </span>
        <span className="hv-task-status">{STATUS_LABEL[status] ?? status}</span>
        {risk ? (
          <span className="hv-task-risk" data-approved={riskApproved || undefined} title="High-impact step">
            {riskApproved ? 'approved' : 'risk'}
          </span>
        ) : null}
      </span>

      <span className="hv-task-title">{title}</span>

      <span className="hv-task-foot">
        <span className="hv-task-cost" data-zero={!costCents || undefined}>
          {fmtCost(costCents)}
        </span>
        {attempts > 0 ? (
          <span className="hv-task-attempts" title="Retries">
            {attempts + 1}x
          </span>
        ) : null}
      </span>
    </button>
  );
}
