import type { AuthUser } from '../lib/mission';

/**
 * Wordmark, tagline, and platform badge. Top-left. The account and history
 * controls live here too, wired by the Overlay to InsForge auth and the user's
 * mission history.
 */

interface HeaderProps {
  user: AuthUser | null;
  onOpenAuth: () => void;
  onOpenHistory: () => void;
}

export function Header({ user, onOpenAuth, onOpenHistory }: HeaderProps) {
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
        The live control tower for AI agents. Delegate a goal, watch a team of
        agents work, and stop or steer them in real time.
      </p>
      <div className="hd-controls">
        <button type="button" className="hd-signin interactive" onClick={onOpenHistory}>
          Missions
        </button>
        <button type="button" className="hd-signin interactive" onClick={onOpenAuth}>
          {user ? (user.name ?? user.email ?? 'Account') : 'Sign in'}
        </button>
      </div>
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
