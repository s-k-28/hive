import { useEffect, useState } from 'react';
import { listMyMissions, reopenMission, type MissionSummary } from '../lib/mission';
import { isLiveBackend } from '../lib/insforge';

/**
 * Mission history: the signed-in user's past missions. Selecting one reopens it,
 * re-subscribing and replaying its persisted events so the cockpit rebuilds the
 * full run. Offline mode has no history (nothing is persisted), so the panel
 * says so. Mounts only when explicitly opened from the header.
 */

interface MissionHistoryProps {
  onClose: () => void;
}

const STATUS_TONE: Record<string, string> = {
  complete: 'var(--green)',
  failed: 'var(--red)',
  running: 'var(--cyan)',
  planning: 'var(--gold)',
  assembling: 'var(--green)',
  paused: 'var(--gold)',
  awaiting_input: 'var(--magenta)',
};

export function MissionHistory({ onClose }: MissionHistoryProps) {
  // Offline mode has no history; start with an empty list so the effect never
  // needs to setState synchronously. Live mode starts null (loading).
  const [missions, setMissions] = useState<MissionSummary[] | null>(
    isLiveBackend ? null : [],
  );

  useEffect(() => {
    if (!isLiveBackend) return;
    let cancelled = false;
    listMyMissions().then((rows) => {
      if (!cancelled) setMissions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = (id: string) => {
    reopenMission(id).catch((err) => console.error('[hive] reopen failed', err));
    onClose();
  };

  return (
    <div className="mh-backdrop interactive" onClick={onClose}>
      <div className="mh glass" role="dialog" aria-label="Your missions" onClick={(e) => e.stopPropagation()}>
        <div className="mh-head">
          <span className="mh-eyebrow">Your missions</span>
          <button type="button" className="mh-close" onClick={onClose} aria-label="Close">
            <CloseGlyph />
          </button>
        </div>

        <div className="mh-scroll">
          {!isLiveBackend ? (
            <p className="mh-muted">
              History is available once an InsForge project is connected. Offline
              missions are not persisted.
            </p>
          ) : missions == null ? (
            <p className="mh-muted">Loading...</p>
          ) : missions.length === 0 ? (
            <p className="mh-muted">No missions yet. Launch one to see it here.</p>
          ) : (
            <ul className="mh-list">
              {missions.map((m) => (
                <li key={m.id}>
                  <button type="button" className="mh-item" onClick={() => open(m.id)}>
                    <span className="mh-goal">{m.goal || 'Untitled mission'}</span>
                    <span
                      className="mh-status"
                      style={{ ['--tone' as string]: STATUS_TONE[m.status] ?? 'var(--ink-dim)' }}
                    >
                      {m.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
