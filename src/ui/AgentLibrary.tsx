import { useMemo, useState } from 'react';
import { AGENT_CATALOG, divisions, divisionLabel, searchAgents } from '../lib/agentCatalog';

/**
 * The Agent Library: browse the full specialist catalog HIVE draws from when it
 * assigns an expert to each task. Search across name/division/description and
 * filter by division. Read-only reference; the planner picks from this same set
 * at mission time (semantic match in the backend; see functions/orchestrator.ts).
 * Mounts only when opened from the command bar.
 */

interface AgentLibraryProps {
  onClose: () => void;
}

export function AgentLibrary({ onClose }: AgentLibraryProps) {
  const [query, setQuery] = useState('');
  const [division, setDivision] = useState<string | null>(null);

  const divs = useMemo(() => divisions(), []);
  const results = useMemo(() => searchAgents(query, division), [query, division]);

  return (
    <div className="mh-backdrop interactive" onClick={onClose}>
      <div className="mh al glass" role="dialog" aria-label="Agent library" onClick={(e) => e.stopPropagation()}>
        <div className="mh-head">
          <div>
            <span className="mh-eyebrow">Agent library</span>
            <span className="al-count">{AGENT_CATALOG.length} specialists · {divs.length} divisions</span>
          </div>
          <button type="button" className="mh-close" onClick={onClose} aria-label="Close">
            <CloseGlyph />
          </button>
        </div>

        <div className="al-controls">
          <input
            className="al-search"
            type="text"
            placeholder="Search specialists by name, skill, or vibe…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="al-divs">
          <button
            type="button"
            className="al-div"
            data-active={division === null}
            onClick={() => setDivision(null)}
          >
            All
          </button>
          {divs.map((d) => (
            <button
              key={d.division}
              type="button"
              className="al-div"
              data-active={division === d.division}
              onClick={() => setDivision(d.division)}
            >
              {divisionLabel(d.division)} <span className="al-div-n">{d.count}</span>
            </button>
          ))}
        </div>

        <div className="mh-scroll al-scroll">
          {results.length === 0 ? (
            <p className="mh-muted">No specialists match “{query}”.</p>
          ) : (
            <ul className="al-grid">
              {results.map((a) => (
                <li key={a.slug} className="al-card" title={a.description}>
                  <span className="al-card-emoji" aria-hidden="true">{a.emoji || '🤖'}</span>
                  <div className="al-card-body">
                    <div className="al-card-name">{a.name}</div>
                    <div className="al-card-div">{divisionLabel(a.division)}</div>
                    {a.vibe ? (
                      <p className="al-card-vibe">{a.vibe}</p>
                    ) : (
                      <p className="al-card-vibe">{a.description}</p>
                    )}
                  </div>
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
