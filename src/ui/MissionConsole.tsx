import { useState } from 'react';
import { useSwarm } from '../state/swarm';
// Single launch entry point. In live mode (InsForge project configured) it
// creates a mission and subscribes to its realtime channel; in dev mode it
// replays the local simulation. Both drive the same applyEvent reducer.
import { startMission } from '../lib/mission';
import { MISSION_STATUS_META } from './agentMeta';

const EXAMPLE_GOALS = [
  'Draft a launch plan for a developer tool',
  'Plan a go-to-market for an AI note app',
  'Outline a technical blog post on agent swarms',
];

export function MissionConsole() {
  const mission = useSwarm((s) => s.mission);
  const [goal, setGoal] = useState('');
  const [expanded, setExpanded] = useState(false);

  const launch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    startMission(trimmed).catch((err) => {
      console.error('[hive] mission launch failed', err);
    });
    setExpanded(false);
  };

  // Collapsed mission bar: a mission exists. Stays out of the way of the scene.
  if (mission) {
    const meta = MISSION_STATUS_META[mission.status];
    const terminal = mission.status === 'complete' || mission.status === 'failed';
    return (
      <div className="mc-bar-wrap">
        <div className="mc-bar glass interactive">
          <span className="mc-bar-label">Mission</span>
          <span className="mc-bar-goal" title={mission.goal}>
            {mission.goal}
          </span>
          <span
            className="status-pill"
            data-status={mission.status}
            style={{ ['--pill' as string]: meta.tone }}
          >
            <span className="status-pill-dot" aria-hidden="true" />
            {meta.label}
          </span>
          {terminal ? (
            <button
              type="button"
              className="mc-bar-new"
              onClick={() => useSwarm.getState().reset()}
            >
              New mission
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // Full launch console: no mission yet. Center stage.
  return (
    <div className="mc-wrap">
      <div className="mc glass interactive">
        <div className="mc-head">
          <h2 className="mc-title">Give the swarm a goal</h2>
          <p className="mc-sub">
            Delegate real work to a transparent agent team and watch it ship.
          </p>
        </div>

        <textarea
          className="mc-input"
          placeholder="Give the swarm a goal..."
          value={goal}
          rows={3}
          onChange={(e) => setGoal(e.target.value)}
          onFocus={() => setExpanded(true)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') launch(goal);
          }}
        />

        <div className="mc-chips" data-expanded={expanded || goal.length > 0}>
          {EXAMPLE_GOALS.map((example) => (
            <button
              key={example}
              type="button"
              className="mc-chip"
              onClick={() => {
                setGoal(example);
                setExpanded(true);
              }}
            >
              {example}
            </button>
          ))}
        </div>

        <div className="mc-actions">
          <span className="mc-hint">Cmd + Enter</span>
          <button
            type="button"
            className="mc-launch"
            disabled={goal.trim().length === 0}
            onClick={() => launch(goal)}
          >
            Launch swarm
          </button>
        </div>
      </div>
    </div>
  );
}
