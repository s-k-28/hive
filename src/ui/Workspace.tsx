import { useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import './design/deck.css';
import {
  AgentChip,
  BrandMark,
  Button,
  CostMeter,
  Eyebrow,
  Input,
  LiveIndicator,
  StatusPill,
  StepCounter,
} from './design/components';
import { MissionTree, Board, GateLayer, Inspector } from './DeckPanels';
import type { InspectorTab } from './DeckPanels';
import { useDeckState, missionStatusMeta } from '../state/deckState';
import type { DeckState } from '../state/deckState';
import { useSwarm } from '../state/swarm';
import { AGENT_ROSTER } from '../lib/types';
import { startMission, pauseMission, resumeMission } from '../lib/mission';
import { isLiveBackend } from '../lib/insforge';

const EXAMPLE_GOALS = [
  'Draft a launch plan for a developer tool',
  'Plan a go-to-market for an AI note app',
  'Outline a technical blog post on agent swarms',
];

/**
 * The HIVE Control Deck (v2: cinematic command). The command bar over a
 * three-column workspace (mission tree, stage, inspector) over the live status
 * strip. Driven entirely by the live `useDeckState` projection of the InsForge
 * realtime store; every control writes a real intervention to the backend.
 */
export function Workspace() {
  const st = useDeckState();
  const focusTask = useSwarm((s) => s.focusTask);
  const setFocusTask = useSwarm((s) => s.setFocusTask);
  const [tab, setTab] = useState<InspectorTab>('activity');

  const meta = st ? missionStatusMeta(st.status) : null;
  const paused = st?.status === 'paused';

  return (
    <div className="ws-app">
      <header className="ws-top">
        <BrandMark
          size="md"
          onClick={() => {
            window.location.hash = '';
          }}
        />
        <LiveIndicator mode={isLiveBackend ? 'live' : 'sim'} />
        <div className="ws-mission">
          {st && meta ? (
            <>
              <span className="ws-mission-goal" title={st.goal}>
                {st.goal}
              </span>
              <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
            </>
          ) : (
            <span className="ws-mission-tag">The live control tower for AI agents</span>
          )}
        </div>
        {st && !st.terminal && (
          <>
            <CostMeter spentCents={st.spentCents} budgetCents={st.budgetCents} />
            <StepCounter stepCount={st.stepCount} maxSteps={st.maxSteps} />
            <Button
              variant="secondary"
              size="sm"
              iconLeft={paused ? <Play size={13} /> : <Pause size={13} />}
              onClick={() => (paused ? resumeMission() : pauseMission())}
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
          </>
        )}
        {st && st.terminal && (
          <Button variant="secondary" size="sm" onClick={() => useSwarm.getState().reset()}>
            New mission
          </Button>
        )}
        <span className="ws-kbd">
          <kbd>&#8984;</kbd>
          <kbd>K</kbd>
        </span>
      </header>

      <div className="ws-body">
        <div className="ws-col-tree">
          <MissionTree st={st} focusTask={focusTask} setFocusTask={setFocusTask} />
        </div>
        <div className="ws-handle" />
        <div className="ws-col-stage">
          <div className="ws-panel ws-panel--center">
            <Stage st={st} focusTask={focusTask} setFocusTask={setFocusTask} />
          </div>
        </div>
        <div className="ws-handle" />
        <div className="ws-col-ins">
          <Inspector st={st} tab={tab} setTab={setTab} focusTask={focusTask} setFocusTask={setFocusTask} />
        </div>
      </div>

      <footer className="ws-status">
        <span className="ws-status-item">
          <b>{st && meta ? meta.label : 'Idle'}</b>
        </span>
        <span className="ws-status-sep" />
        <div className="ws-roster">
          {AGENT_ROSTER.map((a) => (
            <AgentChip key={a.name} name={a.name} role={a.role} visual={st ? st.agents[a.name] : 'idle'} />
          ))}
        </div>
        <div className="ws-status-right">
          <span className="ws-status-item">
            runs on <b style={{ color: 'var(--d-amber)' }}>InsForge</b>
          </span>
          <span className="ws-status-sep" />
          <span className="ws-status-item">
            {st ? `${st.tasks.filter((t) => t.status === 'accepted').length}/${st.tasks.length} accepted` : '0 tasks'}
          </span>
        </div>
      </footer>
    </div>
  );
}

function Stage({
  st,
  focusTask,
  setFocusTask,
}: {
  st: DeckState | null;
  focusTask: string | null;
  setFocusTask: (id: string | null) => void;
}) {
  if (!st) return <LaunchBriefing />;
  if (st.phase === 'planning') {
    return (
      <div className="ws-stage">
        <div className="ws-planning">
          <div className="ws-planning-ring" />
          <div className="ws-planning-text">Planning the mission</div>
        </div>
      </div>
    );
  }
  return (
    <div className="ws-stage">
      <Board st={st} focusTask={focusTask} setFocusTask={setFocusTask} />
      {st.gate && <GateLayer st={st} />}
    </div>
  );
}

function LaunchBriefing() {
  const [goal, setGoal] = useState('');
  const [budget, setBudget] = useState('0.50');
  const [error, setError] = useState<string | null>(null);

  const launch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const dollars = parseFloat(budget);
    const budgetCents = Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
    setError(null);
    startMission(trimmed, { budgetCents }).catch((err) => {
      console.error('[hive] mission launch failed', err);
      setError(err instanceof Error ? err.message : 'Could not start the mission. Please try again.');
    });
  };

  return (
    <div className="lb">
      <div className="lb-card">
        <div className="lb-bar">
          <i />
          <i />
          <i />
          Mission briefing
        </div>
        <div className="lb-body">
          <Eyebrow>New mission</Eyebrow>
          <h1 className="lb-title">Give the swarm a goal.</h1>
          <p className="lb-sub">
            Delegate real work to a transparent agent team, then watch it plan, execute, review, and ship, with cost
            gates and live steering the whole way.
          </p>
          <div className="lb-field">
            <Input
              multiline
              rows={3}
              placeholder="Research current Vercel pricing and summarize the tiers for developers..."
              value={goal}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setGoal(e.currentTarget.value)}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') launch(goal);
              }}
            />
          </div>
          <div className="lb-chips">
            {EXAMPLE_GOALS.map((ex) => (
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
                type="number"
                min="0"
                step="0.25"
                value={budget}
                onChange={(e) => setBudget(e.currentTarget.value)}
                style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', width: 46, outline: 'none' }}
              />
            </label>
            <Button variant="primary" onClick={() => launch(goal)} disabled={!goal.trim()}>
              Launch swarm
            </Button>
          </div>
          {error && (
            <p role="alert" style={{ marginTop: 12, color: 'var(--d-red)', fontSize: 12.5 }}>
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
