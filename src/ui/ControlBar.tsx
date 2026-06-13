import { useState } from 'react';
import { useSwarm } from '../state/swarm';
import { pauseMission, resumeMission, raiseBudget } from '../lib/mission';
import { MISSION_STATUS_META } from './agentMeta';

/**
 * The control bar: the operator's primary cockpit. A pause/resume control, a
 * live cost meter (spent vs budget) with a raise-budget action, the step
 * counter, and the mission status pill. Only mounts during an active mission.
 */

const fmtCents = (c: number): string => `$${(c / 100).toFixed(2)}`;

export function ControlBar() {
  const mission = useSwarm((s) => s.mission);
  const [raising, setRaising] = useState(false);
  const [raiseValue, setRaiseValue] = useState('');

  if (!mission) return null;

  const meta = MISSION_STATUS_META[mission.status];
  const terminal = mission.status === 'complete' || mission.status === 'failed';
  const held = mission.status === 'paused' || mission.status === 'awaiting_input';
  const canPause =
    mission.status === 'running' ||
    mission.status === 'planning' ||
    mission.status === 'assembling';

  const budget = mission.budgetCents;
  const spent = mission.spentCents;
  const pct = budget && budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const over = budget != null && spent >= budget;
  const near = budget != null && !over && pct >= 80;

  const submitRaise = () => {
    const dollars = parseFloat(raiseValue);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setRaising(false);
      return;
    }
    raiseBudget(Math.round(dollars * 100));
    setRaising(false);
    setRaiseValue('');
  };

  return (
    <div className="cb interactive" role="group" aria-label="Mission controls">
      {/* Pause / resume */}
      {!terminal ? (
        <button
          type="button"
          className="cb-btn cb-toggle"
          data-held={held}
          onClick={() => (held ? resumeMission() : pauseMission())}
          disabled={!canPause && !held}
          title={held ? 'Resume the swarm' : 'Pause the swarm'}
        >
          {held ? <PlayGlyph /> : <PauseGlyph />}
          {held ? 'Resume' : 'Pause'}
        </button>
      ) : null}

      {/* Cost meter */}
      <div className="cb-meter" data-state={over ? 'over' : near ? 'near' : 'ok'}>
        <div className="cb-meter-head">
          <span className="cb-meter-label">Cost</span>
          <span className="cb-meter-val">
            {fmtCents(spent)}
            {budget != null ? (
              <>
                <span className="cb-sep">/</span>
                {fmtCents(budget)}
              </>
            ) : (
              <span className="cb-nobudget"> no cap</span>
            )}
          </span>
        </div>
        {budget != null ? (
          <div className="cb-track">
            <div className="cb-fill" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>

      {/* Raise budget */}
      {!terminal ? (
        raising ? (
          <div className="cb-raise">
            <span className="cb-raise-prefix">$</span>
            <input
              className="cb-raise-input"
              type="number"
              min="0"
              step="0.5"
              autoFocus
              value={raiseValue}
              placeholder="2.00"
              onChange={(e) => setRaiseValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRaise();
                if (e.key === 'Escape') setRaising(false);
              }}
            />
            <button type="button" className="cb-raise-go" onClick={submitRaise}>
              Set
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="cb-btn cb-ghost"
            onClick={() => setRaising(true)}
            title="Raise the cost budget"
          >
            Raise budget
          </button>
        )
      ) : null}

      {/* Step counter */}
      <div className="cb-steps" title="Reasoning steps taken">
        <span className="cb-steps-val">{mission.stepCount}</span>
        {mission.maxSteps != null ? (
          <span className="cb-steps-max">/ {mission.maxSteps}</span>
        ) : null}
        <span className="cb-steps-label">steps</span>
      </div>

      {/* Status pill */}
      <span
        className="status-pill cb-status"
        data-status={mission.status}
        style={{ ['--pill' as string]: meta.tone }}
      >
        <span className="status-pill-dot" aria-hidden="true" />
        {meta.label}
      </span>
    </div>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path d="M7 5l12 7-12 7V5z" fill="currentColor" />
    </svg>
  );
}
