import React from 'react';

const fmt = (c: number) => `$${(Number(c) / 100).toFixed(2)}`;

/**
 * HIVE CostMeter. The budget readout from the command bar: spend over budget
 * with a fill bar that shifts amber -> red as it approaches the cap. Pass a
 * null `budgetCents` for an uncapped "no cap" run (no bar).
 */
export interface CostMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  spentCents?: number;
  budgetCents?: number | null;
  label?: string;
}

export function CostMeter({ spentCents = 0, budgetCents = null, label = 'Cost', className = '', ...rest }: CostMeterProps) {
  const capped = budgetCents != null;
  const pct = capped && budgetCents > 0 ? Math.min(100, (spentCents / budgetCents) * 100) : 0;
  const state = capped ? (pct >= 100 ? 'over' : pct >= 80 ? 'near' : 'ok') : 'ok';

  return (
    <div className={['hv-meter', className].filter(Boolean).join(' ')} data-state={state} {...rest}>
      <div className="hv-meter-top">
        <span className="hv-meter-label">{label}</span>
        <span className="hv-meter-val">
          {fmt(spentCents)}
          {capped ? (
            <>
              <span className="sep">/</span>
              {fmt(budgetCents as number)}
            </>
          ) : (
            <span className="cap"> no cap</span>
          )}
        </span>
      </div>
      {capped && (
        <div className="hv-meter-track">
          <div className="hv-meter-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
