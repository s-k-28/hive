import { useState } from 'react';
import { useSwarm } from '../state/swarm';
import { ArtifactViewer } from './ArtifactViewer';

/**
 * Progress and deliverable. Tasks accepted over total with a slim bar, plus the
 * artifact chip that opens the in-app ArtifactViewer (rendered markdown, copy,
 * download) instead of a bare download link. The viewer auto-opens once when the
 * artifact first lands, as the payoff of a completed mission.
 */
export function ProgressArtifact() {
  const tasks = useSwarm((s) => s.tasks);
  const artifact = useSwarm((s) => s.artifact);
  const [viewerOpen, setViewerOpen] = useState(false);
  // Track the artifact we have auto-opened in state and compare during render
  // (React's sanctioned "adjust state when a prop changes" pattern), so the
  // viewer auto-opens exactly once per new artifact.
  const [seenUrl, setSeenUrl] = useState<string | null>(null);
  if (artifact && artifact.url !== seenUrl) {
    setSeenUrl(artifact.url);
    setViewerOpen(true);
  }

  const all = Object.values(tasks);
  const total = all.length;
  const accepted = all.filter((t) => t.status === 'accepted').length;
  const failed = all.some((t) => t.status === 'failed' || t.status === 'killed');

  if (total === 0 && !artifact) return null;

  const pct = total === 0 ? 0 : Math.round((accepted / total) * 100);

  return (
    <>
      <div className="pg interactive">
        {total > 0 ? (
          <div className="pg-progress" aria-label="Task progress">
            <div className="pg-meta">
              <span className="pg-label">Tasks accepted</span>
              <span className="pg-count">
                {accepted}
                <span className="pg-sep">/</span>
                {total}
              </span>
            </div>
            <div className="pg-track" data-failed={failed}>
              <div className="pg-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}

        {artifact ? (
          <button
            type="button"
            className="pg-artifact"
            onClick={() => setViewerOpen(true)}
            title={`Open ${artifact.name}`}
          >
            <ArtifactGlyph />
            <span className="pg-artifact-name">{artifact.name}</span>
            <span className="pg-artifact-action">Open</span>
          </button>
        ) : null}
      </div>

      {artifact && viewerOpen ? (
        <ArtifactViewer
          url={artifact.url}
          name={artifact.name}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </>
  );
}

function ArtifactGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M7 3.5h6.5L18 8v12.5H7Z"
        fill="none"
        stroke="var(--green)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M13 3.5V8h4.5"
        fill="none"
        stroke="var(--green)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
