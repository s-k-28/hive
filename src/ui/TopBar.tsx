import { Hexagon, Play, Pause } from 'lucide-react';
import { useSwarm } from '../state/swarm';
import { useCost } from '../state/selectors';
import { isLiveBackend } from '../lib/insforge';
import { pauseMission, resumeMission } from '../lib/mission';
import { MISSION_STATUS_META } from './agentMeta';

/**
 * The command bar. Brand, live backend pill, the active mission identity, and
 * the operator's at-a-glance instruments: cost meter, step counter, pause or
 * resume, and the command palette.
 */

const fmt = (c: number): string => `$${(c / 100).toFixed(2)}`;

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const mission = useSwarm((s) => s.mission);
  const cost = useCost();

  const meta = mission ? MISSION_STATUS_META[mission.status] : null;
  const terminal = mission?.status === 'complete' || mission?.status === 'failed';
  const held = mission?.status === 'paused' || mission?.status === 'awaiting_input';
  const canPause =
    mission?.status === 'running' ||
    mission?.status === 'planning' ||
    mission?.status === 'assembling';

  return (
    <header className="ws-top">
      <div className="ws-brand">
        <span className="ws-brand-hex"><Hexagon size={19} strokeWidth={2.2} /></span>
        <span className="ws-word">HIVE</span>
      </div>

      <span className="ws-live" data-mode={isLiveBackend ? 'live' : 'sim'}>
        <span className="ws-live-dot" />
        {isLiveBackend ? 'running on InsForge' : 'local simulation'}
      </span>

      <div className="ws-mission">
        {mission ? (
          <>
            <span className="ws-mission-goal" title={mission.goal}>{mission.goal}</span>
            {meta && (
              <span className="ws-pill" style={{ ['--pill' as string]: meta.tone }}>
                <span className="ws-pill-dot" aria-hidden="true" />
                {meta.label}
              </span>
            )}
          </>
        ) : (
          <span className="ws-mission-tag">The live control tower for AI agents</span>
        )}
      </div>

      {mission && !terminal && cost && (
        <>
          <div className="ws-meter" data-state={cost.over ? 'over' : cost.near ? 'near' : 'ok'}>
            <div className="ws-meter-top">
              <span className="ws-meter-label">Cost</span>
              <span className="ws-meter-val">
                {fmt(cost.spentCents)}
                {cost.budgetCents != null ? (
                  <>
                    <span className="sep">/</span>
                    {fmt(cost.budgetCents)}
                  </>
                ) : (
                  <span className="cap"> no cap</span>
                )}
              </span>
            </div>
            {cost.budgetCents != null && (
              <div className="ws-meter-track">
                <div className="ws-meter-fill" style={{ width: `${cost.pct}%` }} />
              </div>
            )}
          </div>

          <span className="ws-steps" title="Reasoning steps">
            <b>{cost.stepCount}</b>
            {cost.maxSteps != null ? `/${cost.maxSteps}` : ''}
            <span className="lbl">steps</span>
          </span>

          <button
            type="button"
            className="ws-btn"
            onClick={() => (held ? resumeMission() : pauseMission())}
            disabled={!canPause && !held}
            title={held ? 'Resume the swarm' : 'Pause the swarm'}
          >
            {held ? <Play size={13} /> : <Pause size={13} />}
            {held ? 'Resume' : 'Pause'}
          </button>
        </>
      )}

      {terminal && (
        <button
          type="button"
          className="ws-btn ws-btn--amber"
          onClick={() => useSwarm.getState().reset()}
        >
          New mission
        </button>
      )}

      <button type="button" className="ws-kbd" onClick={onOpenPalette} title="Command palette">
        <kbd>⌘</kbd><kbd>K</kbd>
      </button>
    </header>
  );
}
