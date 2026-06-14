import React from 'react';

/**
 * HIVE StepCounter. A tabular mono readout of reasoning steps taken against the
 * step cap, for the command bar beside the cost meter.
 */
export interface StepCounterProps extends React.HTMLAttributes<HTMLSpanElement> {
  stepCount?: number;
  maxSteps?: number | null;
  label?: string;
}

export function StepCounter({ stepCount = 0, maxSteps = null, label = 'steps', className = '', ...rest }: StepCounterProps) {
  return (
    <span className={['hv-steps', className].filter(Boolean).join(' ')} title="Reasoning steps" {...rest}>
      <b>{stepCount}</b>
      {maxSteps != null ? `/${maxSteps}` : ''}
      <span className="lbl">{label}</span>
    </span>
  );
}
