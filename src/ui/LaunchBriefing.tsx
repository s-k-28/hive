import { useState } from 'react';
import { GitBranch, X } from 'lucide-react';
import { startMission } from '../lib/mission';
import { RepoPicker } from './RepoPicker';
import { ClarifyChat } from './ClarifyChat';
import type { RepoRef } from '../lib/types';

/**
 * The empty stage: a mission briefing terminal. Replaces the old floating orb
 * hero with a command surface that reads as the start of an operation. A mission
 * can optionally target a GitHub repo (read-only), which the swarm reads for
 * context.
 */

const EXAMPLES = [
  'Draft a launch plan for a developer tool',
  'Plan a go-to-market for an AI note app',
  'Outline a technical blog post on agent swarms',
];

const REPO_EXAMPLES = [
  'Review this codebase and propose the 5 highest-impact improvements',
  'Write a clear README from what this repo actually does',
  'Audit the architecture and flag the riskiest areas',
];

export function LaunchBriefing() {
  const [goal, setGoal] = useState('');
  const [budget, setBudget] = useState('0.50');
  const [repo, setRepo] = useState<RepoRef | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [clarifyOpen, setClarifyOpen] = useState(false);

  // Open the clarifier chat. The swarm launches only after the operator answers
  // (or skips) the questions, so the mission starts already aligned.
  const beginLaunch = () => {
    if (goal.trim().length === 0) return;
    setClarifyOpen(true);
  };

  // Actually start the mission with the clarified brief as guidance.
  const launchWithBrief = (brief: string) => {
    setClarifyOpen(false);
    const dollars = parseFloat(budget);
    const budgetCents =
      Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
    startMission(goal.trim(), { budgetCents, repo, guidance: brief }).catch((err) =>
      console.error('[hive] mission launch failed', err),
    );
  };

  const examples = repo ? REPO_EXAMPLES : EXAMPLES;

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
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') beginLaunch();
              }}
            />
          </div>

          <div className="lb-chips">
            {examples.map((ex) => (
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
            {repo ? (
              <span className="lb-repo" title={`${repo.fullName} @ ${repo.ref}`}>
                <GitBranch size={13} aria-hidden="true" />
                <span className="lb-repo-name">{repo.fullName}</span>
                <span className="lb-repo-ref">{repo.ref}</span>
                <button type="button" className="lb-repo-x" onClick={() => setRepo(null)} aria-label="Remove repo">
                  <X size={12} />
                </button>
              </span>
            ) : (
              <button type="button" className="lb-repo-add" onClick={() => setPickerOpen(true)}>
                <GitBranch size={13} aria-hidden="true" />
                Connect repo
              </button>
            )}
            <button
              type="button"
              className="lb-launch"
              disabled={goal.trim().length === 0}
              onClick={beginLaunch}
            >
              Launch swarm
            </button>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <RepoPicker
          onClose={() => setPickerOpen(false)}
          onSelect={(r) => { setRepo(r); setPickerOpen(false); }}
        />
      )}

      {clarifyOpen && (
        <ClarifyChat
          goal={goal.trim()}
          repo={repo}
          onClose={() => setClarifyOpen(false)}
          onComplete={launchWithBrief}
        />
      )}
    </div>
  );
}
