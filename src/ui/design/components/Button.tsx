import React from 'react';

/**
 * HIVE Button. One primitive for both the control-deck instrument buttons and
 * the marketing CTAs. Amber `primary` is the single brand fill; `secondary`
 * and `ghost` are quiet; `amber` is a tinted outline for in-deck amber actions.
 */
export type ButtonVariant = 'primary' | 'spectrum' | 'amber' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  iconLeft = null,
  iconRight = null,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    'hv-btn',
    `hv-btn--${variant}`,
    size !== 'md' ? `hv-btn--${size}` : '',
    block ? 'hv-btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} {...rest}>
      {iconLeft}
      {children != null && <span>{children}</span>}
      {iconRight}
    </button>
  );
}
