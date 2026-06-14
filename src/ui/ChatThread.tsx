import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, FileText, Send } from 'lucide-react';
import { BrandMark, Button } from './design/components';
import { useConversation } from '../state/conversation';
import type { ChatTurn } from '../state/conversation';
import { useDeckState } from '../state/deckState';
import type { DeckState } from '../state/deckState';
import { useSwarm } from '../state/swarm';
import { approveGate, denyGate, startMission } from '../lib/mission';

const EXAMPLES = [
  'Draft a launch plan for a developer CLI tool',
  'Research the top agent-observability tools and compare them',
  'Outline a technical blog post on agent swarms',
];

const DEFAULT_BUDGET_CENTS = 50;

/**
 * The conversational deck. The operator messages tasks continuously; each
 * message drives a governed agent swarm (watched live in the work view), and the
 * thread carries context forward. Chat with an agent team you can see and steer.
 */
export function ChatThread() {
  const turns = useConversation((s) => s.turns);
  const deck = useDeckState();
  const activeMissionId = useSwarm((s) => s.mission?.id ?? null);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const busy = deck != null && !deck.terminal;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, deck?.status, deck?.tasks.length, deck?.gate]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const convo = useConversation.getState();
    const guidance = convo.buildGuidance();
    convo.addUser(trimmed);
    setDraft('');
    setSendError(null);
    startMission(trimmed, { budgetCents: DEFAULT_BUDGET_CENTS, guidance })
      .then(() => {
        const mid = useSwarm.getState().mission?.id;
        if (mid) useConversation.getState().addAssistant(mid, trimmed);
      })
      .catch((err) => {
        console.error('[hive] message failed', err);
        setSendError(err instanceof Error ? err.message : 'Could not start that task. Try again.');
      });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        {turns.length === 0 ? (
          <ChatWelcome onPick={send} />
        ) : (
          turns.map((t) =>
            t.role === 'user' ? (
              <div className="chat-msg chat-msg--user" key={t.id}>
                <div className="chat-bubble chat-bubble--user">{t.text}</div>
              </div>
            ) : (
              <AssistantTurn key={t.id} turn={t} live={t.missionId === activeMissionId ? deck : null} />
            ),
          )
        )}
      </div>

      <div className="chat-compose">
        {sendError && (
          <p className="chat-error" role="alert">
            {sendError}
          </p>
        )}
        <div className="chat-input">
          <textarea
            className="chat-textarea"
            placeholder={
              busy ? 'The swarm is working. It will be ready for your next task shortly...' : 'Message the swarm. Describe a task to accomplish...'
            }
            value={draft}
            rows={1}
            disabled={busy}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={onKey}
          />
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Send size={14} />}
            onClick={() => send(draft)}
            disabled={!draft.trim() || busy}
          >
            Send
          </Button>
        </div>
        <p className="chat-foot">
          A governed agent swarm: it plans, works in parallel, reviews itself, and stops to ask before high-impact steps.
        </p>
      </div>
    </div>
  );
}

function ChatWelcome({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="chat-welcome">
      <BrandMark size="lg" wordmark={false} />
      <h1 className="chat-welcome-title">What should the swarm build?</h1>
      <p className="chat-welcome-sub">
        Message a task. A team of agents will plan it, work in parallel, review their own results, and ship a deliverable,
        with a live cost meter and hard gates you can see and steer the whole way.
      </p>
      <div className="chat-welcome-chips">
        {EXAMPLES.map((e) => (
          <button key={e} type="button" className="lb-chip" onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

function AssistantTurn({ turn, live }: { turn: ChatTurn; live: DeckState | null }) {
  return (
    <div className="chat-msg chat-msg--assistant">
      <span className="chat-avatar" aria-hidden="true">
        <BrandMark size="sm" wordmark={false} />
      </span>
      <div className="chat-bubble chat-bubble--assistant">
        {live && !live.terminal ? (
          <WorkingStatus deck={live} />
        ) : turn.result ? (
          <div className="chat-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.result}</ReactMarkdown>
          </div>
        ) : turn.status === 'failed' ? (
          <span className="chat-dim">That task could not be completed. Try rephrasing it, or raise the budget and ask again.</span>
        ) : (
          <span className="chat-dim">Working on it...</span>
        )}

        {turn.artifactUrl && (
          <button
            type="button"
            className="chat-artifact"
            onClick={() => window.open(turn.artifactUrl ?? '', '_blank', 'noopener,noreferrer')}
          >
            <FileText size={13} />
            <span>{turn.artifactName ?? 'artifact'}</span>
            <Download size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function WorkingStatus({ deck }: { deck: DeckState }) {
  const accepted = deck.tasks.filter((t) => t.status === 'accepted').length;
  const total = deck.tasks.length;

  if (deck.gate?.kind === 'risk') {
    const task = deck.tasks.find((t) => t.id === deck.gate?.taskId);
    return (
      <div className="chat-working">
        <span className="chat-status chat-status--gate">Held for your approval: {task?.title ?? 'a high-impact step'}</span>
        <span className="chat-latest">Nothing runs until you decide.</span>
        <div className="chat-gate-actions">
          <Button size="sm" variant="secondary" onClick={() => deck.gate?.taskId && denyGate(deck.gate.taskId)}>
            Deny
          </Button>
          <Button size="sm" variant="primary" onClick={() => deck.gate?.taskId && approveGate(deck.gate.taskId)}>
            Approve and continue
          </Button>
        </div>
      </div>
    );
  }

  if (deck.gate?.kind === 'budget' || deck.gate?.kind === 'steps') {
    return (
      <div className="chat-working">
        <span className="chat-status chat-status--gate">
          {deck.gate.kind === 'budget' ? 'Cost budget reached. Paused for you.' : 'Step cap reached. Paused for you.'}
        </span>
        <span className="chat-latest">Raise the limit in the work view to continue.</span>
      </div>
    );
  }

  const latest = deck.log[0];
  const label = deck.phase === 'planning' ? 'Planning the task...' : `Working, ${accepted}/${total} steps accepted`;
  return (
    <div className="chat-working">
      <span className="chat-status">
        <span className="chat-spinner" aria-hidden="true" />
        {label}
      </span>
      {latest && (
        <span className="chat-latest">
          <b style={{ color: latest.color }}>{latest.agent}</b> {latest.text}
        </span>
      )}
      <span className="chat-hint">Watch the swarm work, live, on the right.</span>
    </div>
  );
}
