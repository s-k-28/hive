import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSwarm } from '../state/swarm';
import { colorOf, labelOf } from './agentMeta';
import type { Task } from '../lib/types';

/**
 * The causal inspector: the flight recorder. Click a task node (or an agent) to
 * see why it ran (its dependencies and the memory it recalled), what it produced
 * (rendered markdown), what it cost, and the ordered chain of events that
 * touched it. Opens from focusTask or focusAgent; Esc or the close control
 * clears it (the scene already clears focus on Esc / empty-space click).
 */

const fmtCents = (c: number): string => `$${(c / 100).toFixed(2)}`;

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
  const tasks = useSwarm((s) => s.tasks);
  const log = useSwarm((s) => s.log);

  // Task inspector takes precedence; otherwise an agent inspector.
  const task = focusTask ? tasks[focusTask] : null;
  if (!task && !focusAgent) return null;

  const close = () => {
    useSwarm.getState().setFocusTask(null);
    useSwarm.getState().setFocus(null);
  };

  if (task) {
    const deps = task.dependsOn
      .map((id) => tasks[id])
      .filter((t): t is Task => Boolean(t));
    // The causal chain: log lines that name this task's title or assignee, in
    // order. The log is the human-readable event trace, so this reads as the
    // story of the node without a second event store.
    const chain = log.filter(
      (l) =>
        l.text.includes(task.title) ||
        (task.assignee && l.agent === task.assignee && l.kind !== 'thought'),
    );

    return (
      <Panel onClose={close} title="Task inspector">
        <div className="ins-titlebar">
          <h3 className="ins-title">{task.title}</h3>
          <span
            className="ins-status"
            data-status={task.status}
          >
            {STATUS_LABEL[task.status]}
          </span>
        </div>

        <div className="ins-facts">
          <Fact label="Cost">{fmtCents(task.costCents)}</Fact>
          <Fact label="Attempts">{task.attempts + 1}</Fact>
          {task.risk ? (
            <Fact label="Gate">
              {task.riskApproved ? 'Approved' : 'High-impact'}
            </Fact>
          ) : null}
          {task.assignee ? (
            <Fact label="Agent">
              <span style={{ color: colorOf(task.assignee) }}>{task.assignee}</span>
            </Fact>
          ) : null}
        </div>

        <Section title="Why it ran">
          {deps.length > 0 ? (
            <ul className="ins-deps">
              {deps.map((d) => (
                <li key={d.id} className="ins-dep" data-status={d.status}>
                  <span className="ins-dep-dot" aria-hidden="true" />
                  {d.title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ins-muted">No dependencies. Ran as a root task.</p>
          )}
        </Section>

        {task.feedback ? (
          <Section title="Reviewer feedback">
            <p className="ins-feedback">{task.feedback}</p>
          </Section>
        ) : null}

        <Section title="Output">
          {task.result ? (
            <div className="ins-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.result}</ReactMarkdown>
            </div>
          ) : (
            <p className="ins-muted">No output yet.</p>
          )}
        </Section>

        <Section title="Causal chain">
          {chain.length > 0 ? (
            <ol className="ins-chain">
              {chain.map((l) => (
                <li key={l.seq} className="ins-chain-line" data-kind={l.kind}>
                  <span className="ins-chain-agent" style={{ color: colorOf(l.agent) }}>
                    {labelOf(l.agent)}
                  </span>
                  <span className="ins-chain-text">{l.text}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ins-muted">No recorded events yet.</p>
          )}
        </Section>
      </Panel>
    );
  }

  // Agent inspector.
  const agent = focusAgent!;
  const agentLines = log.filter((l) => l.agent === agent);
  const claimed = Object.values(tasks).filter((t) => t.assignee === agent);

  return (
    <Panel onClose={close} title="Agent inspector">
      <div className="ins-titlebar">
        <h3 className="ins-title" style={{ color: colorOf(agent) }}>
          {agent}
        </h3>
      </div>

      <Section title="Tasks touched">
        {claimed.length > 0 ? (
          <ul className="ins-deps">
            {claimed.map((t) => (
              <li
                key={t.id}
                className="ins-dep ins-dep-click"
                data-status={t.status}
                onClick={() => useSwarm.getState().setFocusTask(t.id)}
              >
                <span className="ins-dep-dot" aria-hidden="true" />
                {t.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ins-muted">No tasks claimed yet.</p>
        )}
      </Section>

      <Section title="Activity">
        {agentLines.length > 0 ? (
          <ol className="ins-chain">
            {agentLines.map((l) => (
              <li key={l.seq} className="ins-chain-line" data-kind={l.kind}>
                <span className="ins-chain-text">{l.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="ins-muted">No activity yet.</p>
        )}
      </Section>
    </Panel>
  );
}

interface PanelProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function Panel({ title, onClose, children }: PanelProps) {
  return (
    <aside className="ins glass interactive" aria-label={title}>
      <div className="ins-head">
        <span className="ins-eyebrow">{title}</span>
        <button type="button" className="ins-close" onClick={onClose} aria-label="Close inspector">
          <CloseGlyph />
        </button>
      </div>
      <div className="ins-scroll">{children}</div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ins-section">
      <h4 className="ins-section-title">{title}</h4>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ins-fact">
      <span className="ins-fact-label">{label}</span>
      <span className="ins-fact-val">{children}</span>
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
