import { useSwarm } from '../state/swarm';

/**
 * Progress and deliverable. Tasks accepted over total with a slim bar, plus
 * the artifact chip and download control once the assembler ships.
 */
export function ProgressArtifact() {
  const tasks = useSwarm((s) => s.tasks);
  const artifact = useSwarm((s) => s.artifact);

  const all = Object.values(tasks);
  const total = all.length;
  const accepted = all.filter((t) => t.status === 'accepted').length;
  const failed = all.some((t) => t.status === 'failed');

  if (total === 0 && !artifact) return null;

  const pct = total === 0 ? 0 : Math.round((accepted / total) * 100);

  return (
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
        <a
          className="pg-artifact"
          href={artifact.url}
          download={artifact.name}
          // In dev the url may be a placeholder (#...). The control is real and
          // becomes a live Storage URL once the assembler uploads.
          title={`Download ${artifact.name}`}
        >
          <ArtifactGlyph />
          <span className="pg-artifact-name">{artifact.name}</span>
          <span className="pg-artifact-action">Download</span>
        </a>
      ) : null}
    </div>
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
