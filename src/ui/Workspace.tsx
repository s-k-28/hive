import { useEffect, useState } from 'react';
import { Pause, Play, SquarePen } from 'lucide-react';
import './design/deck.css';
import './design/chat.css';
import {
  AgentChip,
  BrandMark,
  Button,
  CostMeter,
  LiveIndicator,
  StatusPill,
  StepCounter,
} from './design/components';
import { ChatThread } from './ChatThread';
import { Board, GateLayer, Inspector } from './DeckPanels';
import type { InspectorTab } from './DeckPanels';
import { useDeckState, missionStatusMeta } from '../state/deckState';
import type { DeckState } from '../state/deckState';
import { useSwarm } from '../state/swarm';
import { useConversation } from '../state/conversation';
import { AGENT_ROSTER } from '../lib/types';
import { pauseMission, resumeMission } from '../lib/mission';
import { isLiveBackend } from '../lib/insforge';

/**
 * The HIVE conversational control deck. A chat thread (you message tasks
 * continuously) beside a live work view (the governed swarm executing the
 * current task). The deck adapter drives both from the live InsForge store.
 */
export function Workspace() {
  const deck = useDeckState();
  const focusTask = useSwarm((s) => s.focusTask);
  const setFocusTask = useSwarm((s) => s.setFocusTask);
  const [tab, setTab] = useState<InspectorTab>('activity');

  // Capture each finished mission's artifact back into its chat turn, so the
  // assistant "answers" with the delivered result and past turns keep it.
  const missionId = useSwarm((s) => s.mission?.id ?? null);
  const missionStatus = useSwarm((s) => s.mission?.status ?? null);
  const artifactUrl = useSwarm((s) => s.artifact?.url ?? null);
  const artifactName = useSwarm((s) => s.artifact?.name ?? null);
  useEffect(() => {
    if (!missionId) return;
    const convo = useConversation.getState();
    if (missionStatus === 'complete') {
      if (artifactUrl) {
        fetch(artifactUrl)
          .then((r) => r.text())
          .then((md) => convo.patchAssistant(missionId, { status: 'complete', result: md, artifactName, artifactUrl }))
          .catch(() => convo.patchAssistant(missionId, { status: 'complete', artifactName, artifactUrl }));
      } else {
        convo.patchAssistant(missionId, { status: 'complete' });
      }
    } else if (missionStatus === 'failed') {
      convo.patchAssistant(missionId, { status: 'failed' });
    }
  }, [missionId, missionStatus, artifactUrl, artifactName]);

  const meta = deck ? missionStatusMeta(deck.status) : null;
  const paused = deck?.status === 'paused';
  const turns = useConversation((s) => s.turns);

  const newChat = () => {
    useConversation.getState().reset();
    useSwarm.getState().reset();
  };

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
          {deck && meta ? (
            <>
              <span className="ws-mission-goal" title={deck.goal}>
                {deck.goal}
              </span>
              <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
            </>
          ) : (
            <span className="ws-mission-tag">The live control tower for AI agents</span>
          )}
        </div>
        {deck && !deck.terminal && (
          <>
            <CostMeter spentCents={deck.spentCents} budgetCents={deck.budgetCents} />
            <StepCounter stepCount={deck.stepCount} maxSteps={deck.maxSteps} />
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
        {turns.length > 0 && (deck == null || deck.terminal) && (
          <Button variant="secondary" size="sm" iconLeft={<SquarePen size={13} />} onClick={newChat}>
            New chat
          </Button>
        )}
        <span className="ws-kbd">
          <kbd>&#8984;</kbd>
          <kbd>K</kbd>
        </span>
      </header>

      <div className="ws-body">
        <div className="ws-col-chat">
          <ChatThread />
        </div>
        <div className="ws-handle" />
        <div className="ws-col-work">
          <WorkView deck={deck} focusTask={focusTask} setFocusTask={setFocusTask} tab={tab} setTab={setTab} />
        </div>
      </div>

      <footer className="ws-status">
        <span className="ws-status-item">
          <b>{deck && meta ? meta.label : 'Ready'}</b>
        </span>
        <span className="ws-status-sep" />
        <div className="ws-roster">
          {AGENT_ROSTER.map((a) => (
            <AgentChip key={a.name} name={a.name} role={a.role} visual={deck ? deck.agents[a.name] : 'idle'} />
          ))}
        </div>
        <div className="ws-status-right">
          <span className="ws-status-item">
            runs on <b style={{ color: 'var(--d-amber)' }}>InsForge</b>
          </span>
          <span className="ws-status-sep" />
          <span className="ws-status-item">
            {deck ? `${deck.tasks.filter((t) => t.status === 'accepted').length}/${deck.tasks.length} accepted` : 'idle'}
          </span>
        </div>
      </footer>
    </div>
  );
}

function WorkView({
  deck,
  focusTask,
  setFocusTask,
  tab,
  setTab,
}: {
  deck: DeckState | null;
  focusTask: string | null;
  setFocusTask: (id: string | null) => void;
  tab: InspectorTab;
  setTab: (t: InspectorTab) => void;
}) {
  return (
    <div className="work">
      <div className="work-stage">
        {!deck ? (
          <div className="work-idle">
            <div className="work-idle-ring" aria-hidden="true" />
            <p className="work-idle-text">The swarm's live work appears here. Message a task to begin.</p>
          </div>
        ) : deck.phase === 'planning' ? (
          <div className="ws-planning">
            <div className="ws-planning-ring" />
            <div className="ws-planning-text">Planning the task</div>
          </div>
        ) : (
          <>
            <Board st={deck} focusTask={focusTask} setFocusTask={setFocusTask} />
            {deck.gate && <GateLayer st={deck} />}
          </>
        )}
      </div>
      <div className="work-inspector">
        <Inspector st={deck} tab={tab} setTab={setTab} focusTask={focusTask} setFocusTask={setFocusTask} />
      </div>
    </div>
  );
}
