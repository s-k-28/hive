import { useEffect, useRef, useState } from 'react';
import { X, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSwarm } from '../state/swarm';
import { useCost, useTasksSorted } from '../state/selectors';
import { colorOf, labelOf } from './agentMeta';
import { injectNote, pauseMission, resumeMission, raiseBudget } from '../lib/mission';
import type { Task } from '../lib/types';

/**
 * The inspector (right rail). When a task or agent is focused it becomes a
 * flight recorder for that node; otherwise it is the tabbed mission view: steer,
 * activity, raw reasoning, cost, and the artifact.
 */

type Tab = 'steer' | 'activity' | 'console' | 'cost' | 'artifacts';
const TABS: Tab[] = ['steer', 'activity', 'console', 'cost', 'artifacts'];

const STATUS_LABEL: Record<Task['status'], string> = {
  pending: 'Pending',
  running: 'Running',
  review: 'In review',
  rejected: 'Rejected',
  accepted: 'Accepted',
  failed: 'Failed',
  killed: 'Killed',
};

export function Inspector() {
  const focusTask = useSwarm((s) => s.focusTask);
  const focusAgent = useSwarm((s) => s.focusAgent);
  if (focusTask || focusAgent) {
    return (
      <div className="ws-panel">
        <FocusDetail />
      </div>
    );
  }
  return (
    <div className="ws-panel">
      <Tabs />
    </div>
  );
}

function Tabs() {
  const [tab, setTab] = useState<Tab>('activity');
  const errorCount = useSwarm((s) => s.log.filter((l) => l.kind === 'error').length);
  return (
    <div className="ins">
      <div className="ins-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className="ins-tab"
            data-active={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
            {t === 'console' && errorCount > 0 ? <span className="ins-tab-badge">&#9679;</span> : null}
          </button>
        ))}
      </div>
      <div className="ins-body">
        {tab === 'steer' && <Steer />}
        {tab === 'activity' && <Feed kind="all" />}
        {tab === 'console' && <Feed kind="thought" />}
        {tab === 'cost' && <Cost />}
        {tab === 'artifacts' && <Artifacts />}
      </div>
    </div>
  );
}

function FocusDetail() {
  const focusTask = useSwarm((s) => s.focusTask);
  const focusAgent = useSwarm((s) => s.focusAgent);
  const tasks = useSwarm((s) => s.tasks);
  const log = useSwarm((s) => s.log);
  const task = focusTask ? tasks[focusTask] : null;

  const close = () => {
    useSwarm.getState().setFocusTask(null);
    useSwarm.getState().setFocus(null);
  };

  const head = (label: string) => (
    <div className="det-head">
      <span className="det-eyebrow">{label}</span>
      <button type="button" className="det-close" onClick={close} aria-label="Close inspector">
        <X size={14} />
      </button>
    </div>
  );

  if (task) {
    const deps = task.dependsOn.map((id) => tasks[id]).filter((t): t is Task => Boolean(t));
    const chain = log.filter(
      (l) =>
        l.text.includes(task.title) ||
        (task.assignee && l.agent === task.assignee && l.kind !== 'thought'),
    );
    return (
      <div className="ins">
        {head('Task inspector')}
        <div className="det-body">
          <div className="det-titlebar">
            <h3 className="det-title">{task.title}</h3>
            <span className="ws-pill" style={{ ['--pill' as string]: statusTone(task.status) }}>
              <span className="ws-pill-dot" aria-hidden="true" />
              {STATUS_LABEL[task.status]}
            </span>
          </div>

          <div className="det-facts">
            <Fact label="Cost">${(task.costCents / 100).toFixed(2)}</Fact>
            <Fact label="Attempts">{task.attempts + 1}</Fact>
            {task.risk && <Fact label="Gate">{task.riskApproved ? 'Approved' : 'High-impact'}</Fact>}
            {task.assignee && (
              <Fact label="Agent">
                <span style={{ color: colorOf(task.assignee) }}>{task.assignee}</span>
              </Fact>
            )}
          </div>

          <Section title="Why it ran">
            {deps.length > 0 ? (
              <ul className="det-deps">
                {deps.map((d) => (
                  <li key={d.id} className="det-dep" style={{ ['--c' as string]: statusTone(d.status) }}>
                    <span className="det-dep-dot" aria-hidden="true" />
                    {d.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="det-muted">No dependencies. Ran as a root task.</p>
            )}
          </Section>

          {task.feedback && (
            <Section title="Reviewer feedback">
              <p className="det-feedback">{task.feedback}</p>
            </Section>
          )}

          <Section title="Output">
            {task.result ? (
              <div className="art-render det-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.result}</ReactMarkdown>
              </div>
            ) : (
              <p className="det-muted">No output yet.</p>
            )}
          </Section>

          <Section title="Causal chain">
            {chain.length > 0 ? (
              <ol className="det-chain">
                {chain.map((l) => (
                  <li key={l.seq} className="det-chain-line" data-kind={l.kind}>
                    <span className="det-chain-agent" style={{ color: colorOf(l.agent) }}>
                      {labelOf(l.agent)}
                    </span>
                    <span>{l.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="det-muted">No recorded events yet.</p>
            )}
          </Section>
        </div>
      </div>
    );
  }

  const agent = focusAgent!;
  const agentLines = log.filter((l) => l.agent === agent);
  const claimed = Object.values(tasks).filter((t) => t.assignee === agent);
  return (
    <div className="ins">
      {head('Agent inspector')}
      <div className="det-body">
        <div className="det-titlebar">
          <h3 className="det-title" style={{ color: colorOf(agent) }}>{agent}</h3>
        </div>
        <Section title="Tasks touched">
          {claimed.length > 0 ? (
            <ul className="det-deps">
              {claimed.map((t) => (
                <li
                  key={t.id}
                  className="det-dep det-dep-click"
                  style={{ ['--c' as string]: statusTone(t.status) }}
                  onClick={() => useSwarm.getState().setFocusTask(t.id)}
                >
                  <span className="det-dep-dot" aria-hidden="true" />
                  {t.title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="det-muted">No tasks claimed yet.</p>
          )}
        </Section>
        <Section title="Activity">
          {agentLines.length > 0 ? (
            <ol className="det-chain">
              {agentLines.map((l) => (
                <li key={l.seq} className="det-chain-line" data-kind={l.kind}>
                  <span>{l.text}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="det-muted">No activity yet.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

function statusTone(status: Task['status']): string {
  switch (status) {
    case 'running': return 'var(--d-live)';
    case 'review': return 'var(--d-amber)';
    case 'accepted': return 'var(--d-grn)';
    case 'rejected': return 'var(--d-red)';
    case 'failed': return '#b3263c';
    default: return '#6b7790';
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="det-section">
      <h4 className="det-section-title">{title}</h4>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="det-fact">
      <span className="det-fact-label">{label}</span>
      <span className="det-fact-val">{children}</span>
    </div>
  );
}

function Feed({ kind }: { kind: 'all' | 'thought' }) {
  const log = useSwarm((s) => s.log);
  const lines = kind === 'all' ? log : log.filter((l) => l.kind === 'thought');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines.length]);

  if (lines.length === 0) {
    return (
      <div className="feed-empty">
        {kind === 'thought' ? 'No reasoning yet.' : 'No activity yet. Launch a mission to begin.'}
      </div>
    );
  }
  return (
    <div className="feed">
      {lines.map((l) => (
        <div className="feed-line" data-kind={l.kind} key={l.seq}>
          <span className="feed-agent" style={{ ['--ag' as string]: colorOf(l.agent) }}>
            {labelOf(l.agent)}
          </span>
          <span className="feed-text">{l.text}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function Steer() {
  const mission = useSwarm((s) => s.mission);
  const [note, setNote] = useState('');
  if (!mission) return <div className="panel-empty">Launch a mission, then steer the swarm from here.</div>;

  const held = mission.status === 'paused' || mission.status === 'awaiting_input';
  const terminal = mission.status === 'complete' || mission.status === 'failed';
  const send = () => {
    if (note.trim()) {
      injectNote(note.trim());
      setNote('');
    }
  };

  return (
    <div className="steer">
      <p className="steer-note">Inject a constraint the swarm will respect from here on, or take the wheel.</p>
      <textarea
        className="steer-area"
        placeholder="e.g. Keep it under 200 words and cite a source for every claim."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="steer-row">
        <button type="button" className="ws-btn ws-btn--amber" onClick={send} disabled={!note.trim()}>
          Inject guidance
        </button>
        {!terminal && (
          <button type="button" className="ws-btn" onClick={() => (held ? resumeMission() : pauseMission())}>
            {held ? 'Resume' : 'Pause'}
          </button>
        )}
        {!terminal && (
          <button type="button" className="ws-btn" onClick={() => raiseBudget((mission.budgetCents ?? 0) + 100)}>
            +$1.00 budget
          </button>
        )}
      </div>
      {held && <p className="steer-note">A gate is holding in the stage. Approve or deny it there.</p>}
    </div>
  );
}

function Cost() {
  const cost = useCost();
  const tasks = useTasksSorted();
  if (!cost) return <div className="panel-empty">No mission running.</div>;
  const ledger = tasks.filter((t) => t.costCents > 0);

  return (
    <div className="cost">
      <div>
        <div className="ws-meter-label">Total spend</div>
        <div className="cost-big">
          <span className="cost-big-val">${(cost.spentCents / 100).toFixed(2)}</span>
          <span className="cost-big-cap">
            {cost.budgetCents != null ? `/ $${(cost.budgetCents / 100).toFixed(2)} budget` : 'no cap'}
          </span>
        </div>
      </div>
      <div className="cost-ledger">
        {ledger.length === 0 ? (
          <div className="panel-empty" style={{ padding: '8px 4px' }}>No metered steps yet.</div>
        ) : (
          ledger.map((t) => (
            <div className="cost-row" key={t.id}>
              <span className="cost-row-title">{t.title}</span>
              <span className="cost-row-val">${(t.costCents / 100).toFixed(2)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Artifacts() {
  const artifact = useSwarm((s) => s.artifact);
  const tasks = useTasksSorted();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string | null>(null);

  const accepted = tasks.filter((t) => t.status === 'accepted').length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((accepted / total) * 100) : 0;

  const view = async () => {
    if (!artifact) return;
    setOpen(true);
    if (body == null) {
      try {
        const res = await fetch(artifact.url);
        setBody(await res.text());
      } catch {
        setBody('Could not load the artifact.');
      }
    }
  };

  return (
    <div className="arts">
      <div className="art-progress">
        {accepted}/{total} tasks accepted
        <div className="art-track">
          <div className="art-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {artifact ? (
        <>
          <button type="button" className="art-chip" onClick={view}>
            <FileText size={14} aria-hidden="true" />
            <span className="art-chip-name">{artifact.name}</span>
          </button>
          {open && body != null && (
            <div className="art-render">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </div>
          )}
        </>
      ) : (
        <div className="panel-empty" style={{ padding: '6px 4px' }}>
          The assembled artifact appears here when the mission ships.
        </div>
      )}
    </div>
  );
}
