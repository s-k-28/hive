import type { ReactNode } from 'react';
import { AGENT_ROSTER } from '../lib/types';
import { useSwarm } from '../state/swarm';
import { useTasksSorted } from '../state/selectors';
import { colorOf } from './agentMeta';

/**
 * The mission tree (left rail). The swarm roster and the live plan as two
 * collapsible-feeling sections. Selecting an agent or task drives the same
 * focus state the stage and inspector read.
 */

const STATUS_COLOR: Record<string, string> = {
  pending: '#46587a',
  running: 'var(--d-live)',
  review: 'var(--d-amber)',
  accepted: 'var(--d-grn)',
  rejected: 'var(--d-red)',
  failed: '#b3263c',
  killed: '#55607a',
};

export function MissionTree() {
  const agents = useSwarm((s) => s.agents);
  const focusAgent = useSwarm((s) => s.focusAgent);
  const focusTask = useSwarm((s) => s.focusTask);
  const mission = useSwarm((s) => s.mission);
  const tasks = useTasksSorted();

  return (
    <div className="ws-panel">
      <div className="ws-phead">
        <span className="ws-phead-hex" aria-hidden="true">&#9707;</span>
        Mission
      </div>
      <div className="ws-pbody tree">
        <Section label="Swarm">
          {AGENT_ROSTER.map(({ name }) => {
            const visual = agents[name]?.visual ?? 'idle';
            return (
              <button
                key={name}
                type="button"
                className="tree-row"
                data-focused={focusAgent === name}
                onClick={() => useSwarm.getState().setFocus(focusAgent === name ? null : name)}
              >
                <span
                  className="tree-dot"
                  style={{ ['--c' as string]: colorOf(name), opacity: visual === 'idle' ? 0.5 : 1 }}
                  aria-hidden="true"
                />
                <span className="tree-label">{name}</span>
                <span className="tree-meta">{visual}</span>
              </button>
            );
          })}
        </Section>

        <Section label="Plan">
          {tasks.length === 0 ? (
            <div className="tree-empty">
              {mission ? 'Planning the mission…' : 'No active mission. Launch one from the stage.'}
            </div>
          ) : (
            tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                className="tree-row"
                data-focused={focusTask === t.id}
                onClick={() => useSwarm.getState().setFocusTask(focusTask === t.id ? null : t.id)}
              >
                <span
                  className="tree-sq"
                  style={{ ['--c' as string]: STATUS_COLOR[t.status] ?? '#46587a' }}
                  aria-hidden="true"
                />
                <span className="tree-label">{t.title}</span>
                {t.costCents > 0 && (
                  <span className="tree-meta">${(t.costCents / 100).toFixed(2)}</span>
                )}
              </button>
            ))
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tree-section">
      <div className="tree-shead">
        {label}
        <span className="tree-shead-line" aria-hidden="true" />
      </div>
      {children}
    </div>
  );
}
