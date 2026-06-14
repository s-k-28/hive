import React from 'react';

const HEX_SIZE: Record<string, number> = { sm: 16, md: 19, lg: 26 };

/**
 * HIVE BrandMark (v2). The hexagon "hive" cell, stroked with the role-spectrum
 * gradient and softly bloomed, beside the Geist Mono wordmark. Set
 * `wordmark={false}` for the glyph alone, or pass onClick to make it a home
 * button. `mono` strokes the hexagon flat amber instead of the gradient.
 */
export interface BrandMarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: 'sm' | 'md' | 'lg';
  wordmark?: boolean;
  mono?: boolean;
  strokeWidth?: number;
}

export function BrandMark({
  size = 'md',
  wordmark = true,
  mono = false,
  strokeWidth = 2.2,
  className = '',
  ...rest
}: BrandMarkProps) {
  const px = HEX_SIZE[size] || HEX_SIZE.md;
  const interactive = typeof rest.onClick === 'function';
  // useId is stable across renders/SSR and unique per instance; strip the colons
  // React emits so the value is a valid SVG funciri id (url(#...)).
  const gid = `hv-hexgrad-${React.useId().replace(/:/g, '')}`;
  const classes = ['hv-brand', `hv-brand--${size}`, interactive ? 'hv-brand--link' : '', className]
    .filter(Boolean)
    .join(' ');
  const stroke = mono ? 'var(--d-amber)' : `url(#${gid})`;

  return (
    <span
      className={classes}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e: React.KeyboardEvent<HTMLSpanElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.currentTarget.click();
              }
            }
          : undefined
      }
      {...rest}
    >
      <span className="hv-brand-hex" aria-hidden="true">
        <svg width={px} height={px} viewBox="0 0 24 24" fill="none">
          {!mono && (
            <defs>
              <linearGradient id={gid} x1="2" y1="3" x2="22" y2="21" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#f5b94a" />
                <stop offset="0.4" stopColor="#e34fd0" />
                <stop offset="0.72" stopColor="#34d8f1" />
                <stop offset="1" stopColor="#84e36a" />
              </linearGradient>
            </defs>
          )}
          <path
            d="M21 16.05V7.95a2 2 0 0 0-1-1.73l-7-4.04a2 2 0 0 0-2 0l-7 4.04a2 2 0 0 0-1 1.73v8.1a2 2 0 0 0 1 1.73l7 4.04a2 2 0 0 0 2 0l7-4.04a2 2 0 0 0 1-1.73Z"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {wordmark && <span className="hv-brand-word">HIVE</span>}
    </span>
  );
}
