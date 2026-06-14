import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AgentChip, BrandMark, CostMeter, LiveIndicator, TaskCard } from './design/components';

/**
 * The landing hero's live, auto-playing mini control deck. A scripted mission
 * loops forever with zero clicks: cards bloom in, edges flow, tasks move
 * pending -> running -> review -> accepted, the cost meter counts up, a risk
 * gate pulses, then the plan ships and resets. Purely decorative (no backend).
 */

interface HDTask {
  id: string;
  title: string;
  col: number;
  deps: string[];
  risk?: boolean;
}

interface HDLogLine {
  a: string;
  c: string;
  t: string;
}

interface HDState {
  tasks: Record<string, string>;
  cost: number;
  gate: boolean;
  riskApproved: boolean;
  log: HDLogLine[];
}

const HD_TASKS: HDTask[] = [
  { id: 't1', title: 'Research the landscape', col: 0, deps: [] },
  { id: 't2', title: 'Define the audience', col: 0, deps: [] },
  { id: 't3', title: 'Pick launch channels', col: 1, deps: ['t1'] },
  { id: 't4', title: 'Draft announcement copy', col: 1, deps: ['t2'] },
  { id: 't5', title: 'Assemble the launch plan', col: 2, deps: ['t3', 't4'], risk: true },
];

type ScriptStep = [number, ((s: HDState) => void) | null];

function buildScript(): ScriptStep[] {
  return [
    [400, (s) => { s.log = [{ a: 'planner', c: 'var(--d-amber)', t: 'Decomposing the goal into a task graph.' }]; }],
    [700, (s) => { s.tasks.t1 = 'running'; s.tasks.t2 = 'running'; s.log.unshift({ a: 'worker-1', c: 'var(--d-live)', t: 'claimed: Research the landscape' }); }],
    [600, (s) => { s.cost = 3; s.log.unshift({ a: 'worker-2', c: 'var(--d-live)', t: 'Primary segment: indie builders who want oversight.' }); }],
    [700, (s) => { s.cost = 6; s.log.unshift({ a: 'worker-1', c: 'var(--d-live)', t: 'memory: competitors lead on speed, none on transparency.' }); }],
    [600, (s) => { s.tasks.t1 = 'review'; s.tasks.t2 = 'review'; s.log.unshift({ a: 'critic', c: 'var(--d-mag)', t: 'Reviewing two completed tasks.' }); }],
    [600, (s) => { s.tasks.t1 = 'accepted'; s.tasks.t2 = 'accepted'; s.cost = 8; s.log.unshift({ a: 'critic', c: 'var(--d-mag)', t: 'Accepted. Strong, specific positioning.' }); }],
    [600, (s) => { s.tasks.t3 = 'running'; s.tasks.t4 = 'running'; s.log.unshift({ a: 'worker-3', c: 'var(--d-live)', t: 'claimed: Draft announcement copy' }); }],
    [700, (s) => { s.cost = 12; s.log.unshift({ a: 'worker-3', c: 'var(--d-live)', t: 'Leading with the live control angle.' }); }],
    [700, (s) => { s.tasks.t3 = 'accepted'; s.tasks.t4 = 'accepted'; s.cost = 15; s.log.unshift({ a: 'critic', c: 'var(--d-mag)', t: 'Accepted. Channels match the audience.' }); }],
    [700, (s) => { s.gate = true; s.log.unshift({ a: 'swarm', c: 'var(--d-amber)', t: 'Risk gate: assemble + publish held for approval.' }); }],
    [1500, (s) => { s.gate = false; s.tasks.t5 = 'running'; s.riskApproved = true; s.log.unshift({ a: 'you', c: 'var(--d-amber)', t: 'Approved. Continue.' }); }],
    [900, (s) => { s.cost = 19; s.tasks.t5 = 'accepted'; s.log.unshift({ a: 'assembler', c: 'var(--d-grn)', t: 'Shipped launch-plan.md to storage.' }); }],
    [1900, null],
  ];
}

function initialState(): HDState {
  return {
    tasks: Object.fromEntries(HD_TASKS.map((t) => [t.id, 'pending'])),
    cost: 0,
    gate: false,
    riskApproved: false,
    log: [{ a: 'swarm', c: 'var(--d-faint)', t: 'Mission started: launch plan for HIVE.' }],
  };
}

interface Edge {
  id: string;
  d: string;
  flow: boolean;
}

export function HeroDeck() {
  const [state, setState] = useState<HDState>(initialState);
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce.current) {
      setState({
        tasks: { t1: 'accepted', t2: 'accepted', t3: 'accepted', t4: 'accepted', t5: 'running' },
        cost: 15,
        gate: false,
        riskApproved: true,
        log: [{ a: 'assembler', c: 'var(--d-grn)', t: 'Assembling the launch plan.' }],
      });
      return;
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      const scr = buildScript();
      let s = initialState();
      setState(s);
      let i = 0;
      const tick = () => {
        if (cancelled) return;
        const step = scr[i];
        if (!step) {
          run();
          return;
        }
        const [delay, mut] = step;
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            if (mut) {
              s = structuredClone(s);
              mut(s);
              setState(s);
            }
            i += 1;
            tick();
          }, delay),
        );
      };
      tick();
    };
    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [edges, setEdges] = useState<Edge[]>([]);
  const sig = HD_TASKS.map((t) => state.tasks[t.id]).join('|');

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const raf = requestAnimationFrame(() => {
      const base = stage.getBoundingClientRect();
      const next: Edge[] = [];
      for (const t of HD_TASKS) {
        const childEl = cardRefs.current[t.id];
        if (!childEl) continue;
        const c = childEl.getBoundingClientRect();
        for (const dep of t.deps) {
          const pEl = cardRefs.current[dep];
          if (!pEl) continue;
          const p = pEl.getBoundingClientRect();
          const x1 = p.right - base.left;
          const y1 = p.top + p.height / 2 - base.top;
          const x2 = c.left - base.left;
          const y2 = c.top + c.height / 2 - base.top;
          const mx = x1 + (x2 - x1) / 2;
          next.push({
            id: `${dep}-${t.id}`,
            d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
            flow: state.tasks[t.id] === 'running' || state.tasks[t.id] === 'review',
          });
        }
      }
      setEdges(next);
    });
    return () => cancelAnimationFrame(raf);
    // Recompute connector geometry only when the task status signature changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const cols = [0, 1, 2].map((ci) => HD_TASKS.filter((t) => t.col === ci));
  const last = state.log[0];

  return (
    <div className="hd">
      <div className="hd-head">
        <BrandMark size="sm" />
        <span className="hd-head-goal" title="Draft and launch a go-to-market plan for HIVE">
          Draft and launch a go-to-market plan for HIVE
        </span>
        <div className="hd-head-right">
          <CostMeter spentCents={state.cost} budgetCents={50} />
          <LiveIndicator mode="sim" label="live demo" />
        </div>
      </div>

      <div className="hd-stage" ref={stageRef}>
        <svg className="hd-edges" aria-hidden="true">
          {edges.map((e) => (
            <path key={e.id} className="hd-edge" data-flow={e.flow} d={e.d} />
          ))}
        </svg>
        {cols.map((col, ci) => (
          <div className="hd-col" key={ci}>
            <div className="hd-col-head">
              <span className="hd-col-rail" />
              {ci === 0 ? 'Ready' : `Stage ${ci + 1}`}
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
                  status={state.tasks[t.id]}
                  costCents={state.tasks[t.id] === 'accepted' ? 4 : 0}
                  risk={t.risk}
                  riskApproved={Boolean(t.risk && state.riskApproved)}
                  gated={Boolean(t.risk && state.gate)}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="hd-foot">
        <AgentChip name="planner" role="planner" visual="complete" />
        <AgentChip name="worker-1" role="worker" visual={state.tasks.t3 === 'running' ? 'thinking' : 'complete'} />
        <AgentChip name="critic" role="critic" visual={state.gate ? 'thinking' : 'idle'} />
        <span className="hd-log">
          <b style={{ color: last.c }}>{last.a}</b> {last.t}
        </span>
      </div>
    </div>
  );
}
