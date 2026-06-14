import { useMemo } from 'react';
import { useSwarm } from './swarm';
import { AGENT_ROSTER } from '../lib/types';
import type { AgentVisualState, MissionStatus, TaskStatus } from '../lib/types';

/**
 * Deck adapter. Projects the live `useSwarm` store (fed by InsForge realtime
 * events) into the flat `DeckState` shape the HIVE v2 design panels render. This
 * is the single seam between the proven backend and the new cinematic frontend:
 * the design components stay presentational, the store stays the source of truth.
 *
 * It subscribes to the raw store slices and derives with useMemo, so the snapshot
 * keeps a stable reference between unrelated renders (deriving a fresh object
 * graph inside a useShallow selector would make useSyncExternalStore loop).
 */

export interface DeckTask {
  id: string;
  title: string;
  col: number; // dependency-depth column on the board
  deps: string[];
  assignee: string | null;
  status: TaskStatus;
  costCents: number;
  risk: boolean;
  riskApproved: boolean;
  attempts: number;
}

export interface DeckLogLine {
  seq: number;
  agent: string;
  text: string;
  kind: 'thought' | 'status' | 'error' | 'artifact';
  color: string;
}

export interface DeckState {
  phase: 'planning' | 'running' | 'done';
  goal: string;
  status: MissionStatus;
  budgetCents: number | null;
  spentCents: number;
  stepCount: number;
  maxSteps: number | null;
  tasks: DeckTask[];
  gate: { kind: 'budget' | 'steps' | 'risk'; taskId: string | null } | null;
  artifact: { name: string; url: string } | null;
  agents: Record<string, AgentVisualState>;
  log: DeckLogLine[];
  terminal: boolean;
}

/** Role color by agent role, for tree dots and the activity feed. */
export const ROLE_COLOR: Record<string, string> = {
  planner: 'var(--d-amber)',
  worker: 'var(--d-live)',
  critic: 'var(--d-mag)',
  assembler: 'var(--d-grn)',
  swarm: 'var(--d-faint)',
  you: 'var(--d-amber)',
};

/** Task-status color for the mission-tree squares. */
export const STATUS_COLOR: Record<string, string> = {
  pending: '#46587a',
  running: 'var(--d-live)',
  review: 'var(--d-amber)',
  accepted: 'var(--d-grn)',
  rejected: 'var(--d-red)',
  failed: 'var(--d-red)',
  killed: '#55607a',
};

const ROLE_OF: Record<string, string> = {
  planner: 'planner',
  'worker-1': 'worker',
  'worker-2': 'worker',
  'worker-3': 'worker',
  critic: 'critic',
  assembler: 'assembler',
};

export interface MissionStatusMeta {
  label: string;
  tone: string;
}

/** Mission status -> { label, tone } for the command-bar status pill. */
export function missionStatusMeta(s: MissionStatus): MissionStatusMeta {
  const map: Record<MissionStatus, MissionStatusMeta> = {
    planning: { label: 'Planning', tone: 'planner' },
    running: { label: 'Running', tone: 'worker' },
    assembling: { label: 'Assembling', tone: 'assembler' },
    awaiting_input: { label: 'Awaiting you', tone: 'critic' },
    complete: { label: 'Complete', tone: 'assembler' },
    failed: { label: 'Failed', tone: 'red' },
    paused: { label: 'Paused', tone: 'planner' },
  };
  return map[s] ?? { label: s, tone: 'neutral' };
}

/**
 * Board column for each task = longest dependency chain to a root (depth). Roots
 * (no deps) are column 0; everything else sits one column past its deepest dep.
 * Memoized with a cycle guard so a malformed plan can never loop.
 */
function computeColumns(tasks: { id: string; dependsOn: string[] }[]): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0; // cycle guard
    const t = byId.get(id);
    if (!t || t.dependsOn.length === 0) {
      memo.set(id, 0);
      return 0;
    }
    seen.add(id);
    let max = 0;
    for (const dep of t.dependsOn) {
      if (byId.has(dep)) max = Math.max(max, depth(dep, seen) + 1);
    }
    seen.delete(id);
    memo.set(id, max);
    return max;
  };
  const out = new Map<string, number>();
  for (const t of tasks) out.set(t.id, depth(t.id, new Set()));
  return out;
}

/**
 * The live deck state, or null when no mission is active (idle launch screen).
 * Reactive: re-derives on every realtime event the store applies, and only then.
 */
export function useDeckState(): DeckState | null {
  const mission = useSwarm((s) => s.mission);
  const tasks = useSwarm((s) => s.tasks);
  const agents = useSwarm((s) => s.agents);
  const log = useSwarm((s) => s.log);
  const gate = useSwarm((s) => s.gate);
  const artifact = useSwarm((s) => s.artifact);

  return useMemo<DeckState | null>(() => {
    if (!mission) return null;

    const taskList = Object.values(tasks).sort((a, b) => a.orderIndex - b.orderIndex);
    const colOf = computeColumns(taskList);
    const taskSum = taskList.reduce((acc, t) => acc + (t.costCents || 0), 0);
    const spentCents = Math.max(mission.spentCents, taskSum);

    const phase: DeckState['phase'] =
      mission.status === 'complete' || mission.status === 'failed'
        ? 'done'
        : mission.status === 'planning' || taskList.length === 0
          ? 'planning'
          : 'running';

    const deckTasks: DeckTask[] = taskList.map((t) => ({
      id: t.id,
      title: t.title,
      col: colOf.get(t.id) ?? 0,
      deps: t.dependsOn,
      assignee: t.assignee,
      status: t.status,
      costCents: t.costCents,
      risk: t.risk,
      riskApproved: t.riskApproved,
      attempts: t.attempts,
    }));

    // Backend log is oldest-first; the feed renders newest-first.
    const deckLog: DeckLogLine[] = log
      .map((l): DeckLogLine => {
        const role = l.agent ? (ROLE_OF[l.agent] ?? 'swarm') : 'swarm';
        return {
          seq: l.seq,
          agent: l.agent ?? 'swarm',
          text: l.text,
          kind: l.kind,
          color: ROLE_COLOR[role] ?? 'var(--d-faint)',
        };
      })
      .reverse();

    const deckAgents: Record<string, AgentVisualState> = {};
    for (const a of AGENT_ROSTER) deckAgents[a.name] = agents[a.name]?.visual ?? 'idle';

    return {
      phase,
      goal: mission.goal,
      status: mission.status,
      budgetCents: mission.budgetCents,
      spentCents,
      stepCount: mission.stepCount,
      maxSteps: mission.maxSteps,
      tasks: deckTasks,
      gate: gate ? { kind: gate.kind, taskId: gate.taskId } : null,
      artifact: artifact ? { name: artifact.name, url: artifact.url } : null,
      agents: deckAgents,
      log: deckLog,
      terminal: mission.status === 'complete' || mission.status === 'failed',
    };
  }, [mission, tasks, agents, log, gate, artifact]);
}
