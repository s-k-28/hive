import React from 'react';

/**
 * HIVE LiveIndicator. The breathing-dot status chip. `mode="live"` pulses
 * green ("running on InsForge"); `mode="sim"` pulses amber ("simulation").
 */
export interface LiveIndicatorProps extends React.HTMLAttributes<HTMLSpanElement> {
  mode?: 'live' | 'sim';
  label?: string;
}

export function LiveIndicator({ mode = 'live', label, className = '', ...rest }: LiveIndicatorProps) {
  const text = label ?? (mode === 'live' ? 'running on InsForge' : 'simulation');
  return (
    <span className={['hv-live', className].filter(Boolean).join(' ')} data-mode={mode} {...rest}>
      <span className="hv-live-dot" aria-hidden="true" />
      {text}
    </span>
  );
}
