/**
 * Wordmark, tagline, and platform badge. Top-left. First thing the judge sees
 * in the demo video, so it stays unmistakable and restrained.
 */

interface HeaderProps {
  /** Presentational only. Wired to InsForge auth by the host. */
  onSignIn?: () => void;
}

export function Header({ onSignIn }: HeaderProps) {
  return (
    <header className="hd">
      <div className="hd-mark-row">
        <HexMark />
        <h1 className="hd-mark" aria-label="Hive">
          HIVE
        </h1>
        <span className="hd-badge interactive" title="Runs entirely on InsForge">
          <span className="hd-badge-dot" aria-hidden="true" />
          running on InsForge
        </span>
      </div>
      <p className="hd-tagline">
        Delegate a goal. Watch a team of AI agents plan, execute, review, and
        deliver, live.
      </p>
      {onSignIn ? (
        <button type="button" className="hd-signin interactive" onClick={onSignIn}>
          Sign in
        </button>
      ) : null}
    </header>
  );
}

/** Small honeycomb glyph paired with the wordmark. */
function HexMark() {
  return (
    <svg
      className="hd-glyph"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
    >
      <path
        d="M12 2.6 20.6 7.3v9.4L12 21.4 3.4 16.7V7.3L12 2.6Z"
        fill="none"
        stroke="var(--gold)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.4" fill="var(--gold)" />
    </svg>
  );
}
