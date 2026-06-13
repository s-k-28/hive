import { useState } from 'react';
import { startMission } from '../lib/mission';

/**
 * The empty stage: a mission briefing terminal. Replaces the old floating orb
 * hero with a command surface that reads as the start of an operation.
 */

const EXAMPLES = [
  'Draft a launch plan for a developer tool',
  'Plan a go-to-market for an AI note app',
  'Outline a technical blog post on agent swarms',
];

export function LaunchBriefing() {
  const [goal, setGoal] = useState('');
  const [budget, setBudget] = useState('0.50');

  const launch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const dollars = parseFloat(budget);
    const budgetCents =
      Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
    startMission(trimmed, { budgetCents }).catch((err) =>
      console.error('[hive] mission launch failed', err),
    );
  };

  return (
    <div className="lb">
      <div className="lb-grid" aria-hidden="true" />
      <div className="lb-card">
        <div className="lb-bar">
          <span className="lb-bar-dot" aria-hidden="true" />
          <span className="lb-bar-dot" aria-hidden="true" />
          <span className="lb-bar-dot" aria-hidden="true" />
          <span className="lb-bar-label">mission briefing</span>
        </div>
        <div className="lb-body">
          <div className="lb-eyebrow">New mission</div>
          <h1 className="lb-title">Give the swarm a goal.</h1>
          <p className="lb-sub">
            Delegate real work to a transparent agent team, then watch it plan, execute,
            review, and ship, with cost gates and live steering the whole way.
          </p>

          <div className="lb-input-wrap">
            <span className="lb-caret" aria-hidden="true">&rsaquo;</span>
            <textarea
              className="lb-input"
              rows={3}
              placeholder="Research current Vercel pricing and summarize the tiers for developers..."
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') launch(goal);
              }}
            />
          </div>

          <div className="lb-chips">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="lb-chip" onClick={() => setGoal(ex)}>
                {ex}
              </button>
            ))}
          </div>

          <div className="lb-actions">
            <label className="lb-budget" title="Cost budget. The swarm pauses and asks you when it is reached.">
              <span className="lb-budget-label">Budget</span>
              <span>$</span>
              <input
                className="lb-budget-input"
                type="number"
                min="0"
                step="0.25"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="lb-launch"
              disabled={goal.trim().length === 0}
              onClick={() => launch(goal)}
            >
              Launch swarm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
