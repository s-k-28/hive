import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSwarm } from '../state/swarm';
import { useCost, useTasksSorted } from '../state/selectors';
import { colorOf, labelOf } from './agentMeta';
import { injectNote, pauseMission, resumeMission, raiseBudget } from '../lib/mission';

/**
 * The inspector (right rail). Tabs over the live mission: steer the swarm, watch
 * the activity feed, read raw reasoning, audit cost, and open the artifact.
 */

type Tab = 'steer' | 'activity' | 'console' | 'cost' | 'artifacts';
const TABS: Tab[] = ['steer', 'activity', 'console', 'cost', 'artifacts'];

export function Inspector() {
  const [tab, setTab] = useState<Tab>('activity');
  const errorCount = useSwarm((s) => s.log.filter((l) => l.kind === 'error').length);

  return (
    <div className="ws-panel">
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
      <p className="steer-note">
        Inject a constraint the swarm will respect from here on, or take the wheel.
      </p>
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
          <button
            type="button"
            className="ws-btn"
            onClick={() => raiseBudget((mission.budgetCents ?? 0) + 100)}
          >
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
            <span aria-hidden="true">&#9636;</span>
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
