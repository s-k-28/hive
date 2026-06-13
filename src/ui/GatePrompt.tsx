import { useState } from 'react';
import { useSwarm } from '../state/swarm';
import {
  approveGate,
  denyGate,
  raiseBudget,
  injectNote,
} from '../lib/mission';

/**
 * The gate prompt: when a gate trips, the swarm stops and asks the human. This
 * is the signature moment of the product, so it is unmistakable and gives the
 * operator exactly the right actions for the gate that fired:
 *   risk    -> Approve / Deny the high-impact step (with optional guidance)
 *   budget  -> Raise the budget / Stop the mission
 *   steps   -> Raise the budget is not relevant; offer Resume-with-more or Stop
 * Mounts only while a gate is active (status paused on a budget/step gate, or
 * awaiting_input on a risk gate).
 */

const fmtCents = (c: number): string => `$${(c / 100).toFixed(2)}`;

export function GatePrompt() {
  const mission = useSwarm((s) => s.mission);
  const gate = useSwarm((s) => s.gate);
  const tasks = useSwarm((s) => s.tasks);
  const [raiseValue, setRaiseValue] = useState('');
  const [note, setNote] = useState('');

  if (!mission || !gate) return null;
  // Only show while the mission is actually held by this gate.
  const held = mission.status === 'paused' || mission.status === 'awaiting_input';
  if (!held) return null;

  const gateTask = gate.taskId ? tasks[gate.taskId] : null;

  if (gate.kind === 'risk') {
    return (
      <GateCard
        tone="var(--magenta)"
        title="High-impact step held for approval"
        body={
          <>
            The swarm wants to run a consequential step
            {gateTask ? (
              <>
                {' '}
                <strong className="gp-task">{gateTask.title}</strong>
              </>
            ) : null}
            . Nothing runs until you decide.
          </>
        }
      >
        <textarea
          className="gp-note"
          placeholder="Optional: add a constraint the swarm should follow..."
          value={note}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="gp-actions">
          <button
            type="button"
            className="gp-btn gp-deny"
            onClick={() => gate.taskId && denyGate(gate.taskId)}
          >
            Deny
          </button>
          <button
            type="button"
            className="gp-btn gp-approve"
            onClick={() => {
              if (note.trim()) injectNote(note.trim());
              if (gate.taskId) approveGate(gate.taskId);
              setNote('');
            }}
          >
            Approve and continue
          </button>
        </div>
      </GateCard>
    );
  }

  if (gate.kind === 'budget') {
    return (
      <GateCard
        tone="var(--gold)"
        title="Budget reached"
        body={
          <>
            The mission has spent{' '}
            <strong>{fmtCents(mission.spentCents)}</strong>
            {mission.budgetCents != null ? (
              <> of its {fmtCents(mission.budgetCents)} budget</>
            ) : null}
            . Raise the budget to keep going, or stop here.
          </>
        }
      >
        <div className="gp-raise-row">
          <span className="gp-raise-prefix">$</span>
          <input
            className="gp-raise-input"
            type="number"
            min="0"
            step="0.5"
            value={raiseValue}
            placeholder={mission.budgetCents != null ? (mission.budgetCents / 100 + 1).toFixed(2) : '2.00'}
            onChange={(e) => setRaiseValue(e.target.value)}
          />
        </div>
        <div className="gp-actions">
          <button
            type="button"
            className="gp-btn gp-deny"
            onClick={() => useSwarm.getState().reset()}
          >
            Stop mission
          </button>
          <button
            type="button"
            className="gp-btn gp-approve"
            onClick={() => {
              const dollars = parseFloat(raiseValue);
              const cents = Number.isFinite(dollars) && dollars > 0
                ? Math.round(dollars * 100)
                : (mission.budgetCents ?? 0) + 200;
              raiseBudget(cents);
              setRaiseValue('');
            }}
          >
            Raise budget and resume
          </button>
        </div>
      </GateCard>
    );
  }

  // steps
  return (
    <GateCard
      tone="var(--gold)"
      title="Step cap reached"
      body={
        <>
          The swarm has taken{' '}
          <strong>{mission.stepCount}</strong>
          {mission.maxSteps != null ? <> of {mission.maxSteps}</> : null} reasoning
          steps and paused so it cannot run away. Review the work, then stop here.
        </>
      }
    >
      <div className="gp-actions">
        <button
          type="button"
          className="gp-btn gp-approve"
          onClick={() => useSwarm.getState().reset()}
        >
          Stop mission
        </button>
      </div>
    </GateCard>
  );
}

interface GateCardProps {
  tone: string;
  title: string;
  body: React.ReactNode;
  children: React.ReactNode;
}

function GateCard({ tone, title, body, children }: GateCardProps) {
  return (
    <div className="gp-wrap">
      <div className="gp glass interactive" style={{ ['--gate' as string]: tone }}>
        <div className="gp-head">
          <span className="gp-badge" aria-hidden="true">
            <ShieldGlyph />
          </span>
          <h3 className="gp-title">{title}</h3>
        </div>
        <p className="gp-body">{body}</p>
        {children}
      </div>
    </div>
  );
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M12 3l7 3v5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
