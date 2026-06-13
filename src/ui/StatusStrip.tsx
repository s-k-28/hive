import { AGENT_ROSTER } from '../lib/types';
import { useSwarm } from '../state/swarm';
import { isLiveBackend } from '../lib/insforge';
import { colorOf } from './agentMeta';

/**
 * The bottom status strip: the swarm as a row of live instrument lights, plus
 * memory count and the backend indicator. Reads like a control deck readout.
 */
export function StatusStrip() {
  const agents = useSwarm((s) => s.agents);
  const focusAgent = useSwarm((s) => s.focusAgent);
  const memoryCount = useSwarm((s) => s.memoryCount);

  return (
    <footer className="ws-status">
      <div className="ws-roster" role="group" aria-label="Swarm roster">
        {AGENT_ROSTER.map(({ name }) => (
          <button
            key={name}
            type="button"
            className="ws-rchip"
            data-visual={agents[name]?.visual ?? 'idle'}
            data-focused={focusAgent === name}
            onClick={() => useSwarm.getState().setFocus(focusAgent === name ? null : name)}
          >
            <span className="ws-rdot" style={{ ['--dot' as string]: colorOf(name) }} aria-hidden="true" />
            {name}
          </button>
        ))}
      </div>
      <div className="ws-status-right">
        <span className="ws-status-item">memory <b>{memoryCount}</b></span>
        <span className="ws-status-sep" aria-hidden="true" />
        <span className="ws-status-item">
          <span className="ws-live-dot" style={{ width: 6, height: 6 }} aria-hidden="true" />
          {isLiveBackend ? 'InsForge' : 'simulation'}
        </span>
      </div>
    </footer>
  );
}
