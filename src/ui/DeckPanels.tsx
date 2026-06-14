import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Download, FileText, X } from 'lucide-react';
import { Button, GatePrompt, Input, StatusPill, TaskCard } from './design/components';
import { ROLE_COLOR, STATUS_COLOR } from '../state/deckState';
import type { DeckState, DeckTask } from '../state/deckState';
import { AGENT_ROSTER } from '../lib/types';
import {
  approveGate,
  denyGate,
  injectNote,
  pauseMission,
  raiseBudget,
  resumeMission,
} from '../lib/mission';

type FocusSetter = (taskId: string | null) => void;

const cssVar = (vars: Record<string, string | number>): CSSProperties => vars as CSSProperties;

/* ---- Mission tree (swarm roster + plan) --------------------------------- */

export function MissionTree({
  st,
  focusTask,
  setFocusTask,
}: {
  st: DeckState | null;
  focusTask: string | null;
  setFocusTask: FocusSetter;
}) {
  return (
    <div className="ws-panel">
      <div className="ws-phead">
        <span className="ws-phead-hex">&#9707;</span>Mission
      </div>
      <div className="ws-pbody tree">
        <div className="tree-section">
          <div className="tree-shead">
            Swarm<span className="tree-shead-line" />
          </div>
          {AGENT_ROSTER.map((a) => {
            const active = st ? st.agents[a.name] !== 'idle' : false;
            return (
              <div key={a.name} className="tree-row" aria-hidden="true">
                <span
                  className="tree-dot"
                  style={cssVar({ '--c': ROLE_COLOR[a.role], opacity: active ? 1 : 0.5 })}
                />
                <span className="tree-label">{a.name}</span>
                <span className="tree-meta">{st ? st.agents[a.name] : 'idle'}</span>
              </div>
            );
          })}
        </div>
        <div className="tree-section">
          <div className="tree-shead">
            Plan<span className="tree-shead-line" />
          </div>
          {!st || st.tasks.length === 0 ? (
            <div className="panel-empty" style={{ padding: '12px 14px', fontSize: 12 }}>
              {st ? 'Planning the mission.' : 'No active mission.'}
            </div>
          ) : (
            st.tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                className="tree-row"
                data-focused={focusTask === t.id}
                onClick={() => setFocusTask(focusTask === t.id ? null : t.id)}
              >
                <span className="tree-sq" style={cssVar({ '--c': STATUS_COLOR[t.status] || '#4a5a7e' })} />
                <span className="tree-label">{t.title}</span>
                {t.costCents > 0 && <span className="tree-meta">${(t.costCents / 100).toFixed(2)}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- The DAG board ------------------------------------------------------ */

interface Edge {
  id: string;
  d: string;
  flow: boolean;
}

export function Board({
  st,
  focusTask,
  setFocusTask,
}: {
  st: DeckState;
  focusTask: string | null;
  setFocusTask: FocusSetter;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [edges, setEdges] = useState<Edge[]>([]);
  const sig = st.tasks.map((t) => `${t.id}:${t.status}`).join('|');

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const raf = requestAnimationFrame(() => {
      const base = scroller.getBoundingClientRect();
      const next: Edge[] = [];
      for (const t of st.tasks) {
        const c = cardRefs.current[t.id]?.getBoundingClientRect();
        if (!c) continue;
        for (const dep of t.deps) {
          const p = cardRefs.current[dep]?.getBoundingClientRect();
          if (!p) continue;
          const x1 = p.right - base.left + scroller.scrollLeft;
          const y1 = p.top + p.height / 2 - base.top + scroller.scrollTop;
          const x2 = c.left - base.left + scroller.scrollLeft;
          const y2 = c.top + c.height / 2 - base.top + scroller.scrollTop;
          const mx = x1 + (x2 - x1) / 2;
          next.push({
            id: `${dep}-${t.id}`,
            d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
            flow: t.status === 'running' || t.status === 'review',
          });
        }
      }
      setEdges(next);
    });
    return () => cancelAnimationFrame(raf);
    // Recompute connector geometry only when the plan's status signature changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const maxCol = st.tasks.reduce((m, t) => Math.max(m, t.col), 0);
  const cols = Array.from({ length: maxCol + 1 }, (_, ci) => st.tasks.filter((t) => t.col === ci));

  return (
    <div className="board" ref={scrollRef}>
      <svg className="board-edges" aria-hidden="true">
        {edges.map((e) => (
          <path key={e.id} className="board-edge" data-flow={e.flow} d={e.d} />
        ))}
      </svg>
      <div className="board-cols">
        {cols.map((col, ci) => (
          <div className="board-col" key={ci}>
            <div className="board-col-head">
              <span className="board-col-rail" />
              {ci === 0 ? 'Ready to start' : `Stage ${ci + 1}`}
            </div>
            {col.map((t) => (
              <div
                key={t.id}
                ref={(el) => {
                  cardRefs.current[t.id] = el;
                }}
              >
                <TaskCard
                  title={t.title}
                  status={t.status}
                  costCents={t.costCents}
                  risk={t.risk}
                  riskApproved={t.riskApproved}
                  gated={st.gate?.taskId === t.id}
                  focused={focusTask === t.id}
                  attempts={t.attempts}
                  onClick={() => setFocusTask(t.id)}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Gate layer (the stop-and-ask moment) ------------------------------- */

export function GateLayer({ st }: { st: DeckState }) {
  const gate = st.gate;
  if (!gate) return null;

  if (gate.kind === 'risk') {
    const task = st.tasks.find((x) => x.id === gate.taskId);
    return (
      <GatePrompt
        tone="magenta"
        title="High-impact step held for approval"
        actions={
          <>
            <Button variant="secondary" onClick={() => gate.taskId && denyGate(gate.taskId)}>
              Deny
            </Button>
            <Button variant="primary" onClick={() => gate.taskId && approveGate(gate.taskId)}>
              Approve and continue
            </Button>
          </>
        }
      >
        The swarm wants to run a consequential step <strong>{task?.title ?? 'a high-impact task'}</strong>. Nothing
        runs until you decide.
      </GatePrompt>
    );
  }

  const isBudget = gate.kind === 'budget';
  return (
    <GatePrompt
      tone="amber"
      title={isBudget ? 'Cost budget reached' : 'Step cap reached'}
      actions={
        isBudget ? (
          <Button variant="primary" onClick={() => raiseBudget((st.budgetCents ?? 0) + 100)}>
            Raise +$1.00 and continue
          </Button>
        ) : (
          <Button variant="primary" onClick={() => resumeMission()}>
            Resume
          </Button>
        )
      }
    >
      {isBudget
        ? 'The swarm spent its full budget and paused. Raise the cap to let it finish.'
        : 'The swarm reached its reasoning-step cap and paused.'}
    </GatePrompt>
  );
}

/* ---- Inspector tabs ----------------------------------------------------- */

function Feed({ st, kind }: { st: DeckState | null; kind: 'all' | 'thought' }) {
  const lines = !st ? [] : kind === 'all' ? st.log : st.log.filter((l) => l.kind === 'thought');
  if (lines.length === 0) return <div className="panel-empty">No activity yet. Launch a mission to begin.</div>;
  return (
    <div className="feed">
      {lines.map((l) => (
        <div className="feed-line" data-kind={l.kind} key={l.seq}>
          <span className="feed-agent" style={cssVar({ '--ag': l.color })}>
            {l.agent}
          </span>
          <span className="feed-text">{l.text}</span>
        </div>
      ))}
    </div>
  );
}

function Steer({ st }: { st: DeckState | null }) {
  const [note, setNote] = useState('');
  if (!st) return <div className="panel-empty">Launch a mission, then steer the swarm from here.</div>;
  const submit = () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    injectNote(trimmed);
    setNote('');
  };
  return (
    <div className="steer">
      <p className="steer-note">Inject a constraint the swarm will respect from here on, or take the wheel.</p>
      <Input
        multiline
        rows={3}
        placeholder="e.g. Keep it under 200 words and cite a source for every claim."
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
      />
      <div className="steer-row">
        <Button variant="amber" size="sm" onClick={submit} disabled={!note.trim()}>
          Inject guidance
        </Button>
        <Button variant="secondary" size="sm" onClick={() => pauseMission()}>
          Pause swarm
        </Button>
        <Button variant="secondary" size="sm" onClick={() => raiseBudget((st.budgetCents ?? 0) + 100)}>
          +$1.00 budget
        </Button>
      </div>
    </div>
  );
}

function Cost({ st }: { st: DeckState | null }) {
  if (!st) return <div className="panel-empty">No mission running.</div>;
  const ledger = st.tasks.filter((t) => t.costCents > 0);
  return (
    <div className="cost">
      <div>
        <div className="cost-label">Total spend</div>
        <div className="cost-big">
          <span className="cost-big-val">${(st.spentCents / 100).toFixed(2)}</span>
          <span className="cost-big-cap">
            {st.budgetCents != null ? `/ $${(st.budgetCents / 100).toFixed(2)} budget` : 'no cap'}
          </span>
        </div>
      </div>
      <div className="cost-ledger">
        {ledger.length === 0 ? (
          <div className="panel-empty" style={{ padding: '8px 4px' }}>
            No metered steps yet.
          </div>
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

function Artifacts({ st }: { st: DeckState | null }) {
  if (!st) return <div className="panel-empty">The assembled artifact appears here.</div>;
  const accepted = st.tasks.filter((t) => t.status === 'accepted').length;
  const pct = st.tasks.length ? Math.round((accepted / st.tasks.length) * 100) : 0;
  return (
    <div className="arts">
      <div className="art-progress">
        {accepted}/{st.tasks.length} tasks accepted
        <div className="art-track">
          <div className="art-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {st.artifact ? (
        <button
          type="button"
          className="art-chip"
          onClick={() => st.artifact && window.open(st.artifact.url, '_blank', 'noopener,noreferrer')}
        >
          <FileText size={14} />
          <span style={{ flex: 1 }}>{st.artifact.name}</span>
          <Download size={14} />
        </button>
      ) : (
        <div className="panel-empty" style={{ padding: '6px 4px' }}>
          The assembled artifact appears here when the mission ships.
        </div>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '7px 10px',
        border: '1px solid var(--d-line)',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.015)',
        minWidth: 60,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--d-mono)',
          fontSize: 8.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--d-faint)',
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: 'var(--d-mono)', fontSize: 12.5, color: 'var(--d-text)' }}>{children}</span>
    </div>
  );
}

function TaskDetail({ st, task, onClose }: { st: DeckState; task: DeckTask; onClose: () => void }) {
  const deps = task.deps.map((id) => st.tasks.find((t) => t.id === id)).filter(Boolean) as DeckTask[];
  const tone =
    task.status === 'accepted'
      ? 'assembler'
      : task.status === 'running'
        ? 'worker'
        : task.status === 'rejected'
          ? 'red'
          : 'neutral';
  const assigneeRole = AGENT_ROSTER.find((a) => a.name === task.assignee)?.role;
  return (
    <div className="ins">
      <div className="ws-phead" style={{ paddingRight: 6 }}>
        <span style={{ color: 'var(--d-amber)', letterSpacing: '0.18em' }}>Task inspector</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: 'var(--d-faint)',
            cursor: 'pointer',
            display: 'inline-flex',
          }}
          aria-label="Close inspector"
        >
          <X size={14} />
        </button>
      </div>
      <div className="ins-body" style={{ padding: '14px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, color: 'var(--d-text)' }}>{task.title}</h3>
          <StatusPill tone={tone}>{task.status}</StatusPill>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Fact label="Cost">${(task.costCents / 100).toFixed(2)}</Fact>
          {task.assignee && (
            <Fact label="Agent">
              <span style={{ color: assigneeRole ? ROLE_COLOR[assigneeRole] : 'var(--d-text)' }}>{task.assignee}</span>
            </Fact>
          )}
          {task.attempts > 0 && <Fact label="Tries">{task.attempts + 1}x</Fact>}
          {task.risk && <Fact label="Gate">{task.riskApproved ? 'Approved' : 'High-impact'}</Fact>}
        </div>
        <section style={{ marginTop: 16 }}>
          <h4
            style={{
              fontFamily: 'var(--d-mono)',
              fontSize: 9.5,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--d-faint)',
              marginBottom: 8,
            }}
          >
            Depends on
          </h4>
          {deps.length ? (
            deps.map((d) => (
              <div
                key={d.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--d-dim)', padding: '3px 0' }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: STATUS_COLOR[d.status],
                    boxShadow: `0 0 6px ${STATUS_COLOR[d.status]}`,
                  }}
                />
                {d.title}
              </div>
            ))
          ) : (
            <p style={{ fontSize: 12.5, color: 'var(--d-faint)' }}>No dependencies. Ran as a root task.</p>
          )}
        </section>
      </div>
    </div>
  );
}

const TABS = ['steer', 'activity', 'console', 'cost', 'artifacts'] as const;
export type InspectorTab = (typeof TABS)[number];

export function Inspector({
  st,
  tab,
  setTab,
  focusTask,
  setFocusTask,
}: {
  st: DeckState | null;
  tab: InspectorTab;
  setTab: (t: InspectorTab) => void;
  focusTask: string | null;
  setFocusTask: FocusSetter;
}) {
  const task = st && focusTask ? st.tasks.find((t) => t.id === focusTask) : null;
  if (st && task) {
    return (
      <div className="ws-panel">
        <TaskDetail st={st} task={task} onClose={() => setFocusTask(null)} />
      </div>
    );
  }
  return (
    <div className="ws-panel">
      <div className="ins">
        <div className="ins-tabs">
          {TABS.map((t) => (
            <button key={t} type="button" className="ins-tab" data-active={tab === t} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="ins-body">
          {tab === 'steer' && <Steer st={st} />}
          {tab === 'activity' && <Feed st={st} kind="all" />}
          {tab === 'console' && <Feed st={st} kind="thought" />}
          {tab === 'cost' && <Cost st={st} />}
          {tab === 'artifacts' && <Artifacts st={st} />}
        </div>
      </div>
    </div>
  );
}
