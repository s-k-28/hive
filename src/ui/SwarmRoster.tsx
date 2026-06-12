import { useSwarm } from '../state/swarm';
import { AGENT_ROSTER } from '../lib/types';
import { colorOf } from './agentMeta';

/**
 * The six agents as a row of pills. Each reflects its live visual state and
 * focuses the camera on click. Clicking the focused agent again clears focus.
 */
export function SwarmRoster() {
  const agents = useSwarm((s) => s.agents);
  const focusAgent = useSwarm((s) => s.focusAgent);

  return (
    <div className="rs interactive" role="group" aria-label="Swarm roster">
      {AGENT_ROSTER.map(({ name }) => {
        const visual = agents[name]?.visual ?? 'idle';
        const focused = focusAgent === name;
        return (
          <button
            type="button"
            key={name}
            className="rs-pill"
            data-visual={visual}
            data-focused={focused}
            aria-pressed={focused}
            onClick={() => useSwarm.getState().setFocus(focused ? null : name)}
          >
            <span
              className="rs-dot"
              style={{ ['--dot' as string]: colorOf(name) }}
              aria-hidden="true"
            />
            <span className="rs-name">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
