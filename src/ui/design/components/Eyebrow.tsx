import React from 'react';

/**
 * HIVE Eyebrow. An uppercase Geist Mono label with wide tracking, amber by
 * default. Sits above headings and section heads as a mission-control kicker.
 */
export interface EyebrowProps extends React.HTMLAttributes<HTMLElement> {
  muted?: boolean;
  tight?: boolean;
  spectrum?: boolean;
  as?: React.ElementType;
}

export function Eyebrow({
  muted = false,
  tight = false,
  spectrum = false,
  as: Tag = 'span',
  className = '',
  children,
  ...rest
}: EyebrowProps) {
  const classes = [
    'hv-eyebrow',
    muted ? 'hv-eyebrow--muted' : '',
    tight ? 'hv-eyebrow--tight' : '',
    spectrum ? 'hv-eyebrow--spectrum' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
