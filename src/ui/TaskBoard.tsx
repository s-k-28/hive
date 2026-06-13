import { useSwarm } from '../state/swarm';
import type { Task, TaskStatus } from '../lib/types';

/**
 * The 2D task board. A static, DOM-only visualization of the swarm that replaces
 * the 3D scene: the dependency graph laid out in dependency-depth columns, each
 * task a card colored by status, clickable to open the causal Inspector. No
 * animation, no canvas, no per-frame work. The 3D scene code still lives in
 * src/scene/ and can be reinstated by swapping it back into App.tsx.
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

/** Dependency depth = longest chain to a root. Mirrors the scene layout math. */
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

export function TaskBoard() {
  const tasks = useSwarm((s) => s.tasks);
  const gate = useSwarm((s) => s.gate);
  const focusTask = useSwarm((s) => s.focusTask);

  const list = Object.values(tasks);

  if (list.length === 0) {
    return (
      <div className="tb-empty" aria-hidden="true">
        <div className="tb-empty-core" />
      </div>
    );
  }

  const depths = computeDepths(list);
  const maxDepth = Math.max(0, ...list.map((t) => depths.get(t.id) ?? 0));
  const columns: Task[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const t of list) columns[depths.get(t.id) ?? 0].push(t);
  for (const col of columns) col.sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <div className="tb" role="group" aria-label="Task board">
      <div className="tb-cols">
        {columns.map((col, i) => (
          <div className="tb-col" key={i}>
            <div className="tb-col-head">
              {i === 0 ? 'Ready to start' : `Depends on stage ${i}`}
            </div>
            {col.map((task) => {
              const gated = gate?.kind === 'risk' && gate.taskId === task.id;
              return (
                <button
                  type="button"
                  key={task.id}
                  className="tb-card"
                  data-status={task.status}
                  data-gated={gated}
                  data-focused={focusTask === task.id}
                  onClick={() => useSwarm.getState().setFocusTask(task.id)}
                >
                  <span className="tb-card-title">{task.title}</span>
                  <span className="tb-card-meta">
                    <span className="tb-card-status">{STATUS_LABEL[task.status]}</span>
                    {task.costCents > 0 ? (
                      <span className="tb-card-cost">${(task.costCents / 100).toFixed(2)}</span>
                    ) : null}
                    {task.risk ? (
                      <span className="tb-card-risk" title="High-impact step">
                        {task.riskApproved ? 'approved' : 'risk'}
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
  );
}
