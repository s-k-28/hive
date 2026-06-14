import { useLayoutEffect, useRef, useState } from 'react';
import { useSwarm } from '../state/swarm';
import type { Task, TaskStatus } from '../lib/types';

/**
 * The mission board. The single live view of the swarm: a DOM-only directed
 * acyclic graph of the plan, laid out in dependency-depth columns with drawn
 * connector edges so the structure reads at a glance. Each task is a glass card
 * with a premium per-status treatment, easing in when the plan lands and
 * transitioning smoothly as it moves pending -> running -> review -> accepted.
 * Running cards carry a subtle working shimmer; a gated card pulses amber. Every
 * card opens the causal inspector on click or keyboard activation.
 *
 * Performance: no canvas and no per-frame work. Connector edges are recomputed
 * only when the structural signature (which tasks exist, their status, the
 * focused or gated card) changes, via a layout effect that measures card rects
 * once and writes SVG paths. Status and entrance animation are pure CSS.
 */

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  review: 'In review',
  rejected: 'Rejected',
  accepted: 'Accepted',
  failed: 'Failed',
  killed: 'Killed',
};

/** Dependency depth = longest chain to a root. Drives the column layout. */
function computeDepths(tasks: Task[]): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const resolve = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    const task = byId.get(id);
    if (!task || task.dependsOn.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let max = 0;
    for (const dep of task.dependsOn) {
      if (byId.has(dep)) max = Math.max(max, resolve(dep) + 1);
    }
    visiting.delete(id);
    depth.set(id, max);
    return max;
  };
  for (const t of tasks) resolve(t.id);
  return depth;
}

interface Edge {
  id: string;
  d: string;
  /** the child task status, so the edge can light up when work is flowing in */
  childStatus: TaskStatus;
}

export function TaskBoard() {
  const tasks = useSwarm((s) => s.tasks);
  const gate = useSwarm((s) => s.gate);
  const focusTask = useSwarm((s) => s.focusTask);

  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [edges, setEdges] = useState<Edge[]>([]);

  const list = Object.values(tasks);

  // A structural signature: recompute connectors only when something that can
  // move a card changes (task set, each status, depends_on), not on every render.
  const signature = list
    .map((t) => `${t.id}:${t.status}:${t.dependsOn.join('+')}`)
    .sort()
    .join('|');

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || list.length === 0) {
      setEdges([]);
      return;
    }
    const draw = () => {
      const base = scroller.getBoundingClientRect();
      const next: Edge[] = [];
      for (const task of list) {
        const childEl = cardRefs.current.get(task.id);
        if (!childEl) continue;
        const c = childEl.getBoundingClientRect();
        for (const depId of task.dependsOn) {
          const parentEl = cardRefs.current.get(depId);
          if (!parentEl) continue;
          const p = parentEl.getBoundingClientRect();
          // Connect the parent's right edge to the child's left edge, in the
          // scroller's content coordinate space (include scroll offset).
          const x1 = p.right - base.left + scroller.scrollLeft;
          const y1 = p.top + p.height / 2 - base.top + scroller.scrollTop;
          const x2 = c.left - base.left + scroller.scrollLeft;
          const y2 = c.top + c.height / 2 - base.top + scroller.scrollTop;
          const mx = x1 + (x2 - x1) / 2;
          next.push({
            id: `${depId}->${task.id}`,
            d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
            childStatus: task.status,
          });
        }
      }
      setEdges(next);
    };
    // Measure after layout settles (fonts, entrance transforms). One rAF is
    // enough; this runs only on structural changes, not per frame.
    const raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (list.length === 0) {
    return (
      <div className="tb tb-idle" aria-hidden="true">
        <div className="tb-idle-core" />
        <div className="tb-idle-ring" />
      </div>
    );
  }

  const depths = computeDepths(list);
  const maxDepth = Math.max(0, ...list.map((t) => depths.get(t.id) ?? 0));
  const columns: Task[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const t of list) columns[depths.get(t.id) ?? 0].push(t);
  for (const col of columns) col.sort((a, b) => a.orderIndex - b.orderIndex);

  const open = (id: string) => useSwarm.getState().setFocusTask(id);

  return (
    <div className="tb" role="group" aria-label="Mission board">
      <div className="tb-scroll" ref={scrollRef}>
        {/* Connector layer, behind the cards. */}
        <svg className="tb-edges" aria-hidden="true">
          {edges.map((e) => (
            <path
              key={e.id}
              className="tb-edge"
              data-flow={e.childStatus === 'running' || e.childStatus === 'review'}
              d={e.d}
            />
          ))}
        </svg>

        <div className="tb-cols">
          {columns.map((col, i) => (
            <div className="tb-col" key={i}>
              <div className="tb-col-head">
                <span className="tb-col-rail" aria-hidden="true" />
                {i === 0 ? 'Ready to start' : `Stage ${i + 1}`}
              </div>
              {col.map((task) => {
                const gated = gate?.kind === 'risk' && gate.taskId === task.id;
                return (
                  <button
                    type="button"
                    key={task.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(task.id, el);
                      else cardRefs.current.delete(task.id);
                    }}
                    className="tb-card"
                    data-status={task.status}
                    data-gated={gated || undefined}
                    data-focused={focusTask === task.id || undefined}
                    aria-label={`${task.title}. ${STATUS_LABEL[task.status]}. Open inspector.`}
                    onClick={() => open(task.id)}
                  >
                    <span className="tb-card-top">
                      <span className="tb-card-dot" aria-hidden="true">
                        {task.status === 'running' ? <span className="tb-card-spin" /> : null}
                      </span>
                      <span className="tb-card-status">{STATUS_LABEL[task.status]}</span>
                      {task.risk ? (
                        <span
                          className="tb-card-risk"
                          data-approved={task.riskApproved || undefined}
                          title="High-impact step"
                        >
                          {task.riskApproved ? 'approved' : 'risk'}
                        </span>
                      ) : null}
                    </span>

                    <span className="tb-card-title">{task.title}</span>

                    {task.specialist ? (
                      <span
                        className="tb-card-spec"
                        title={`${task.specialist.name} · ${task.specialist.division}`}
                      >
                        <span className="tb-card-spec-emoji" aria-hidden="true">
                          {task.specialist.emoji || '🤖'}
                        </span>
                        <span className="tb-card-spec-name">{task.specialist.name}</span>
                      </span>
                    ) : null}

                    <span className="tb-card-foot">
                      {task.costCents > 0 ? (
                        <span className="tb-card-cost">${(task.costCents / 100).toFixed(2)}</span>
                      ) : (
                        <span className="tb-card-cost tb-card-cost-zero">$0.00</span>
                      )}
                      {task.attempts > 0 ? (
                        <span className="tb-card-attempts" title="Retries">
                          {task.attempts + 1}x
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
