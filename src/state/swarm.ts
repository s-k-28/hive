import { create } from 'zustand';
import type {
  AgentName,
  AgentVisualState,
  Mission,
  SwarmEventRecord,
  Task,
} from '../lib/types';
import { AGENT_ROSTER } from '../lib/types';

/**
 * Swarm store. Fed by realtime events (or the local simulation), read two
 * ways:
 *  - reactively (selector hooks) by the DOM overlay
 *  - transiently (useSwarm.getState() inside useFrame) by the 3D scene,
 *    so events never re-render the canvas tree.
 */

export interface AgentRuntime {
  name: AgentName;
  visual: AgentVisualState;
  /** ms timestamp of the last visual-state change, drives decay animations */
  visualSince: number;
  /** task currently claimed, if any */
  taskId: string | null;
}

export interface LogLine {
  seq: number;
  agent: AgentName | null;
  text: string;
  kind: 'thought' | 'status' | 'error' | 'artifact';
  at: string;
}

/** Transient one-shot effects the scene consumes and clears. */
export interface SceneFx {
  rejectPulses: { taskId: string; at: number }[];
  recallThreads: { agent: AgentName; count: number; at: number }[];
  burstAt: number | null; // mission_completed bloom burst
}

/** An active gate holding the swarm. Read by the cockpit and the scene. */
export interface GateState {
  kind: 'budget' | 'steps' | 'risk';
  taskId: string | null;
  at: number; // performance.now() when it tripped, for a one-shot scene pulse
}

interface SwarmState {
  mission: Mission | null;
  tasks: Record<string, Task>;
  agents: Record<AgentName, AgentRuntime>;
  log: LogLine[];
  memoryCount: number;
  artifact: { url: string; name: string } | null;
  focusAgent: AgentName | null;
  focusTask: string | null;
  gate: GateState | null;
  fx: SceneFx;
  lastSeq: number;

  startMission: (mission: Mission) => void;
  applyEvent: (record: SwarmEventRecord) => void;
  setTasks: (tasks: Task[]) => void;
  setFocus: (agent: AgentName | null) => void;
  setFocusTask: (taskId: string | null) => void;
  reset: () => void;
}

const freshAgents = (): Record<AgentName, AgentRuntime> =>
  Object.fromEntries(
    AGENT_ROSTER.map((a) => [
      a.name,
      { name: a.name, visual: 'idle', visualSince: 0, taskId: null } satisfies AgentRuntime,
    ]),
  ) as Record<AgentName, AgentRuntime>;

const freshFx = (): SceneFx => ({ rejectPulses: [], recallThreads: [], burstAt: null });

const MAX_LOG = 200;

export const useSwarm = create<SwarmState>((set, get) => ({
  mission: null,
  tasks: {},
  agents: freshAgents(),
  log: [],
  memoryCount: 0,
  artifact: null,
  focusAgent: null,
  focusTask: null,
  gate: null,
  fx: freshFx(),
  lastSeq: 0,

  startMission: (mission) =>
    set({
      mission,
      tasks: {},
      agents: freshAgents(),
      log: [],
      memoryCount: 0,
      artifact: null,
      focusAgent: null,
      focusTask: null,
      gate: null,
      fx: freshFx(),
      lastSeq: 0,
    }),

  setTasks: (tasks) =>
    set((s) => ({
      tasks: { ...s.tasks, ...Object.fromEntries(tasks.map((t) => [t.id, t])) },
    })),

  setFocus: (agent) => set({ focusAgent: agent }),

  setFocusTask: (taskId) => set({ focusTask: taskId }),

  reset: () =>
    set({
      mission: null,
      tasks: {},
      agents: freshAgents(),
      log: [],
      memoryCount: 0,
      artifact: null,
      focusAgent: null,
      focusTask: null,
      gate: null,
      fx: freshFx(),
      lastSeq: 0,
    }),

  applyEvent: (record) => {
    const { event, seq, createdAt } = record;
    if (seq <= get().lastSeq) return; // dedupe replays
    const now = performance.now();

    set((s) => {
      const agents = { ...s.agents };
      const tasks = { ...s.tasks };
      const log = [...s.log];
      const fx: SceneFx = {
        rejectPulses: [...s.fx.rejectPulses],
        recallThreads: [...s.fx.recallThreads],
        burstAt: s.fx.burstAt,
      };
      let { mission, memoryCount, artifact, gate } = s;

      const pushLog = (line: Omit<LogLine, 'seq' | 'at'>) => {
        log.push({ ...line, seq, at: createdAt });
        if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
      };
      const setVisual = (name: AgentName, visual: AgentVisualState, taskId?: string | null) => {
        const a = agents[name];
        if (!a) return;
        agents[name] = {
          ...a,
          visual,
          visualSince: now,
          taskId: taskId === undefined ? a.taskId : taskId,
        };
      };

      switch (event.type) {
        case 'mission_started':
          if (mission) mission = { ...mission, status: 'planning' };
          pushLog({ agent: null, kind: 'status', text: `Mission started: ${event.goal}` });
          break;

        case 'agent_spawned':
          setVisual(event.agent, 'idle');
          pushLog({ agent: event.agent, kind: 'status', text: `${event.agent} online` });
          break;

        case 'plan_created':
          if (mission) mission = { ...mission, status: 'running' };
          for (const [i, t] of event.tasks.entries()) {
            tasks[t.id] = {
              id: t.id,
              missionId: mission?.id ?? '',
              title: t.title,
              description: '',
              status: 'pending',
              dependsOn: t.dependsOn,
              assignee: null,
              result: null,
              feedback: null,
              attempts: 0,
              orderIndex: i,
              costCents: 0,
              risk: false,
              riskApproved: false,
            };
          }
          setVisual('planner', 'complete');
          pushLog({ agent: 'planner', kind: 'status', text: `Plan ready: ${event.tasks.length} tasks` });
          break;

        case 'task_claimed':
          if (tasks[event.taskId]) {
            tasks[event.taskId] = { ...tasks[event.taskId], status: 'running', assignee: event.agent };
          }
          setVisual(event.agent, 'thinking', event.taskId);
          pushLog({ agent: event.agent, kind: 'status', text: `claimed: ${tasks[event.taskId]?.title ?? event.taskId}` });
          break;

        case 'agent_thought':
          setVisual(event.agent, 'thinking');
          pushLog({ agent: event.agent, kind: 'thought', text: event.text });
          break;

        case 'memory_stored':
          memoryCount += 1;
          pushLog({ agent: event.agent, kind: 'status', text: `memory: ${event.summary}` });
          break;

        case 'memory_recalled':
          fx.recallThreads.push({ agent: event.agent, count: event.memoryIds.length, at: now });
          pushLog({ agent: event.agent, kind: 'status', text: `recalled ${event.memoryIds.length} memories` });
          break;

        case 'task_completed':
          if (tasks[event.taskId]) {
            tasks[event.taskId] = { ...tasks[event.taskId], status: 'review', result: event.summary };
          }
          setVisual(event.agent, 'complete', null);
          pushLog({ agent: event.agent, kind: 'status', text: `done: ${event.summary}` });
          break;

        case 'task_reviewed': {
          const t = tasks[event.taskId];
          if (t) {
            tasks[event.taskId] = {
              ...t,
              status: event.verdict,
              feedback: event.verdict === 'rejected' ? event.feedback : t.feedback,
            };
          }
          if (event.verdict === 'rejected') fx.rejectPulses.push({ taskId: event.taskId, at: now });
          setVisual('critic', event.verdict === 'rejected' ? 'error' : 'complete');
          pushLog({
            agent: 'critic',
            kind: event.verdict === 'rejected' ? 'error' : 'status',
            text: `${event.verdict}: ${t?.title ?? event.taskId}${event.verdict === 'rejected' ? ` (${event.feedback})` : ''}`,
          });
          break;
        }

        case 'task_failed':
          if (tasks[event.taskId]) {
            tasks[event.taskId] = { ...tasks[event.taskId], status: 'failed' };
          }
          setVisual(event.agent, 'error', null);
          pushLog({ agent: event.agent, kind: 'error', text: `failed: ${event.error}` });
          break;

        case 'artifact_created':
          artifact = { url: event.url, name: event.name };
          if (mission) mission = { ...mission, status: 'assembling', artifactUrl: event.url };
          pushLog({ agent: 'assembler', kind: 'artifact', text: `artifact ready: ${event.name}` });
          break;

        case 'mission_completed':
          if (mission) mission = { ...mission, status: 'complete' };
          fx.burstAt = now;
          pushLog({ agent: null, kind: 'status', text: 'Mission complete' });
          break;

        case 'mission_failed':
          if (mission) mission = { ...mission, status: 'failed' };
          pushLog({ agent: null, kind: 'error', text: `Mission failed: ${event.reason}` });
          break;

        // --- control tower ---------------------------------------------------

        case 'budget_updated':
          if (mission)
            mission = {
              ...mission,
              spentCents: event.spentCents,
              budgetCents: event.budgetCents,
              stepCount: event.stepCount,
              maxSteps: event.maxSteps,
            };
          break;

        case 'gate_tripped':
          gate = { kind: event.kind, taskId: event.taskId, at: now };
          if (mission)
            mission = {
              ...mission,
              status: event.kind === 'risk' ? 'awaiting_input' : 'paused',
            };
          if (event.kind === 'risk' && event.taskId && tasks[event.taskId]) {
            tasks[event.taskId] = { ...tasks[event.taskId], risk: true };
          }
          pushLog({
            agent: null,
            kind: 'error',
            text:
              event.kind === 'budget'
                ? 'Gate: budget reached. Swarm paused for your decision.'
                : event.kind === 'steps'
                  ? 'Gate: step cap reached. Swarm paused for your decision.'
                  : `Gate: high-impact step held for approval${event.taskId ? ` (${tasks[event.taskId]?.title ?? event.taskId})` : ''}.`,
          });
          break;

        case 'intervention_applied':
          pushLog({
            agent: null,
            kind: 'status',
            text: `Steering: ${event.kind}${event.note ? ` - ${event.note}` : ''}`,
          });
          break;

        case 'mission_paused':
          if (mission) mission = { ...mission, status: 'paused' };
          pushLog({ agent: null, kind: 'status', text: 'Swarm paused' });
          break;

        case 'mission_resumed':
          gate = null;
          if (mission && (mission.status === 'paused' || mission.status === 'awaiting_input')) {
            mission = { ...mission, status: 'running' };
          }
          pushLog({ agent: null, kind: 'status', text: 'Swarm resumed' });
          break;

        case 'task_killed':
          if (tasks[event.taskId]) {
            tasks[event.taskId] = { ...tasks[event.taskId], status: 'killed', assignee: null };
          }
          // A kill clears a risk gate that was holding on this task.
          if (gate && gate.kind === 'risk' && gate.taskId === event.taskId) gate = null;
          pushLog({
            agent: null,
            kind: 'status',
            text: `killed: ${tasks[event.taskId]?.title ?? event.taskId}`,
          });
          break;
      }

      return { mission, tasks, agents, log, memoryCount, artifact, gate, fx, lastSeq: seq };
    });
  },
}));

/** Scene-side helper: consume one-shot fx older than `ttlMs`. */
export function pruneFx(ttlMs = 2500) {
  const { fx } = useSwarm.getState();
  const cutoff = performance.now() - ttlMs;
  const rejectPulses = fx.rejectPulses.filter((p) => p.at > cutoff);
  const recallThreads = fx.recallThreads.filter((t) => t.at > cutoff);
  if (
    rejectPulses.length !== fx.rejectPulses.length ||
    recallThreads.length !== fx.recallThreads.length
  ) {
    useSwarm.setState({ fx: { ...fx, rejectPulses, recallThreads } });
  }
}
