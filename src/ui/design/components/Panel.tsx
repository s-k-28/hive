import React from 'react';

/**
 * HIVE Panel. The deck panel scaffold: a mono uppercase header (with an
 * optional amber hex glyph and a right-aligned count) over a scrolling body.
 * Use `bare` to drop the border/radius when the panel fills a resizable column.
 */
export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: React.ReactNode;
  count?: React.ReactNode;
  hex?: boolean;
  bare?: boolean;
}

export function Panel({ title, count = null, hex = true, bare = false, className = '', children, ...rest }: PanelProps) {
  const classes = ['hv-panel', bare ? 'hv-panel--bare' : '', className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {title != null && (
        <div className="hv-panel-head">
          {hex && (
            <span className="hv-panel-hex" aria-hidden="true">
              &#9707;
            </span>
          )}
          {title}
          {count != null && <span className="hv-panel-count">{count}</span>}
        </div>
      )}
      <div className="hv-panel-body">{children}</div>
    </div>
  );
}
