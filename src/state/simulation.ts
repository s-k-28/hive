import type { Mission, SwarmEvent, SwarmEventRecord } from '../lib/types';
import { useSwarm } from './swarm';

/**
 * Local mission simulation. Replays a scripted swarm run through the same
 * applyEvent path the realtime channel uses, so the scene and overlay can be
 * built and demoed without the backend. Also exercised by unit tests.
 *
 * The script now also drives the control tower: a live cost meter that climbs
 * (budget_updated), one risk gate that holds the swarm (gate_tripped('risk') ->
 * awaiting_input), then the human steering it forward (intervention_applied
 * 'approve' + mission_resumed), before assembly and completion. Offline steering
 * controls (pause, resume, approve, etc.) route here through dev mode in
 * src/lib/mission.ts and apply immediately.
 */

const T = {
  research: 'task-research',
  audience: 'task-audience',
  channels: 'task-channels',
  copy: 'task-copy',
  plan: 'task-plan',
};

/** Demo budget for the offline run, in cents. The script spends up against it. */
export const SIM_BUDGET_CENTS = 50;

function script(goal: string): [number, SwarmEvent][] {
  return [
    [0, { type: 'mission_started', goal }],
    [400, { type: 'agent_spawned', agent: 'planner', role: 'planner' }],
    [700, { type: 'agent_spawned', agent: 'worker-1', role: 'worker' }],
    [850, { type: 'agent_spawned', agent: 'worker-2', role: 'worker' }],
    [1000, { type: 'agent_spawned', agent: 'worker-3', role: 'worker' }],
    [1150, { type: 'agent_spawned', agent: 'critic', role: 'critic' }],
    [1300, { type: 'agent_spawned', agent: 'assembler', role: 'assembler' }],
    [1700, { type: 'agent_thought', agent: 'planner', taskId: null, text: 'Decomposing the goal into independent workstreams with clear dependencies.' }],
    [3200, {
      type: 'plan_created',
      tasks: [
        { id: T.research, title: 'Research the competitive landscape', dependsOn: [] },
        { id: T.audience, title: 'Define the target audience', dependsOn: [] },
        { id: T.channels, title: 'Pick launch channels', dependsOn: [T.audience] },
        { id: T.copy, title: 'Draft announcement copy', dependsOn: [T.research, T.audience] },
        { id: T.plan, title: 'Assemble the launch plan', dependsOn: [T.channels, T.copy] },
      ],
    }],
    [3400, { type: 'budget_updated', spentCents: 4, budgetCents: SIM_BUDGET_CENTS, stepCount: 1, maxSteps: null }],
    [4200, { type: 'task_claimed', taskId: T.research, agent: 'worker-1' }],
    [4400, { type: 'task_claimed', taskId: T.audience, agent: 'worker-2' }],
    [5200, { type: 'agent_thought', agent: 'worker-1', taskId: T.research, text: 'Scanning comparable products: positioning, pricing, launch angles.' }],
    [5900, { type: 'agent_thought', agent: 'worker-2', taskId: T.audience, text: 'Primary segment looks like indie builders who want delegation with oversight.' }],
    [7000, { type: 'memory_stored', agent: 'worker-1', memoryId: 'm1', summary: 'Competitors lead with speed, none lead with transparency.' }],
    [8200, { type: 'task_completed', taskId: T.research, agent: 'worker-1', summary: 'Landscape mapped; transparency is the open angle.' }],
    [8400, { type: 'budget_updated', spentCents: 13, budgetCents: SIM_BUDGET_CENTS, stepCount: 2, maxSteps: null }],
    [8900, { type: 'memory_stored', agent: 'worker-2', memoryId: 'm2', summary: 'Audience: builders who distrust black-box agents.' }],
    [9600, { type: 'task_completed', taskId: T.audience, agent: 'worker-2', summary: 'Audience defined with three personas.' }],
    [9800, { type: 'budget_updated', spentCents: 21, budgetCents: SIM_BUDGET_CENTS, stepCount: 3, maxSteps: null }],
    [10400, { type: 'task_reviewed', taskId: T.research, verdict: 'accepted', feedback: '' }],
    [11000, { type: 'task_reviewed', taskId: T.audience, verdict: 'accepted', feedback: '' }],
    [11600, { type: 'task_claimed', taskId: T.channels, agent: 'worker-3' }],
    [11800, { type: 'task_claimed', taskId: T.copy, agent: 'worker-1' }],
    [12600, { type: 'memory_recalled', agent: 'worker-1', taskId: T.copy, memoryIds: ['m1', 'm2'] }],
    [13400, { type: 'agent_thought', agent: 'worker-1', taskId: T.copy, text: 'Recalled: transparency is the wedge. Leading the copy with "watch it think."' }],
    [14600, { type: 'task_completed', taskId: T.channels, agent: 'worker-3', summary: 'Channels: launch video, builder communities, founder network.' }],
    [14800, { type: 'budget_updated', spentCents: 29, budgetCents: SIM_BUDGET_CENTS, stepCount: 4, maxSteps: null }],
    [15400, { type: 'task_completed', taskId: T.copy, agent: 'worker-1', summary: 'Announcement drafted around live agent transparency.' }],
    [15600, { type: 'budget_updated', spentCents: 36, budgetCents: SIM_BUDGET_CENTS, stepCount: 5, maxSteps: null }],
    [16200, { type: 'task_reviewed', taskId: T.channels, verdict: 'accepted', feedback: '' }],
    [17000, { type: 'task_reviewed', taskId: T.copy, verdict: 'rejected', feedback: 'Too feature-led. Open with the problem.' }],
    [17800, { type: 'task_claimed', taskId: T.copy, agent: 'worker-1' }],
    [18600, { type: 'agent_thought', agent: 'worker-1', taskId: T.copy, text: 'Rewriting: problem first, proof second, product third.' }],
    [20000, { type: 'task_completed', taskId: T.copy, agent: 'worker-1', summary: 'Copy rewritten, problem-first.' }],
    [20200, { type: 'budget_updated', spentCents: 42, budgetCents: SIM_BUDGET_CENTS, stepCount: 6, maxSteps: null }],
    [20800, { type: 'task_reviewed', taskId: T.copy, verdict: 'accepted', feedback: '' }],
    // The synthesis is the high-impact step. The risk gate holds the swarm and
    // asks the human before the assembler composes the final deliverable.
    [21400, { type: 'gate_tripped', kind: 'risk', taskId: T.plan }],
    [23400, { type: 'intervention_applied', kind: 'approve', taskId: T.plan, note: 'Synthesis approved by operator' }],
    [23600, { type: 'mission_resumed' }],
    [24000, { type: 'task_claimed', taskId: T.plan, agent: 'assembler' }],
    [24800, { type: 'agent_thought', agent: 'assembler', taskId: T.plan, text: 'Composing accepted outputs into the final launch plan.' }],
    [26000, { type: 'task_completed', taskId: T.plan, agent: 'assembler', summary: 'Launch plan assembled.' }],
    [26200, { type: 'budget_updated', spentCents: 47, budgetCents: SIM_BUDGET_CENTS, stepCount: 7, maxSteps: null }],
    [26600, { type: 'task_reviewed', taskId: T.plan, verdict: 'accepted', feedback: '' }],
    [27400, { type: 'artifact_created', url: SIM_ARTIFACT_URL, name: 'launch-plan.md' }],
    [28200, { type: 'mission_completed' }],
  ];
}

/**
 * A real, readable artifact for the offline run, as a data URL so the in-app
 * ArtifactViewer renders genuine markdown and the download control works without
 * a backend. Live runs replace this with a Storage URL.
 */
const SIM_ARTIFACT_MARKDOWN = `# Launch plan: a transparent agent platform

## Overview
A focused go-to-market built around one wedge the category ignores:
transparency. Buyers can watch the swarm plan, execute, review, and ship, then
stop or steer it in real time.

## Competitive landscape
Competitors lead with raw speed and autonomy. None lead with oversight. That
leaves "trustworthy, watchable delegation" wide open.

## Target audience
Indie builders and small teams who want to delegate real work to agents but do
not trust a black box. Three personas: the solo founder, the staff engineer
automating toil, and the ops lead under compliance pressure.

## Channels
A short launch film, builder communities, and the founder network, in that
order, so the demo carries the message.

## Announcement copy
Problem first: agents that run away cost real money and do real damage. Proof
second: watch one work, then pause it mid-run. Product third: the live control
tower for AI agents.
`;

const SIM_ARTIFACT_URL =
  'data:text/markdown;charset=utf-8,' + encodeURIComponent(SIM_ARTIFACT_MARKDOWN);

export interface SimulationHandle {
  stop: () => void;
}

export function runSimulation(goal = 'Draft a launch plan for Hive'): SimulationHandle {
  const mission: Mission = {
    id: 'sim-mission',
    goal,
    status: 'planning',
    artifactUrl: null,
    createdAt: new Date().toISOString(),
    budgetCents: SIM_BUDGET_CENTS,
    spentCents: 0,
    stepCount: 0,
    maxSteps: null,
    guidance: null,
  };
  useSwarm.getState().startMission(mission);

  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const [i, [delay, event]] of script(goal).entries()) {
    timers.push(
      setTimeout(() => {
        // Allocate the seq at fire time as lastSeq + 1 rather than a fixed index,
        // so manual offline steering (which uses the same allocator) can slot in
        // between scripted events without poisoning the reducer's seq dedupe.
        const seq = useSwarm.getState().lastSeq + 1;
        const record: SwarmEventRecord = {
          id: `sim-${i}`,
          missionId: mission.id,
          seq,
          event,
          createdAt: new Date().toISOString(),
        };
        useSwarm.getState().applyEvent(record);
      }, delay),
    );
  }
  return { stop: () => timers.forEach(clearTimeout) };
}

// ---------------------------------------------------------------------------
// Offline steering. In dev mode (no InsForge client) the control-plane helpers
// in src/lib/mission.ts route here so every cockpit action works without a
// backend. Each applies immediately by pushing a synthetic event through the
// same reducer, with a monotonic seq beyond the script's range.
// ---------------------------------------------------------------------------

let simSteerSeq = 0;

function steer(event: SwarmEvent): void {
  const state = useSwarm.getState();
  const mission = state.mission;
  if (!mission) return;
  simSteerSeq += 1;
  // Use lastSeq + 1 so a steering event always advances past whatever the
  // script has applied so far, keeping the reducer's monotonic dedupe happy.
  state.applyEvent({
    id: `sim-steer-${simSteerSeq}`,
    missionId: mission.id,
    seq: state.lastSeq + 1,
    event,
    createdAt: new Date().toISOString(),
  });
}

export function simPause(): void {
  steer({ type: 'mission_paused' });
}

export function simResume(): void {
  steer({ type: 'mission_resumed' });
}

export function simRaiseBudget(cents: number): void {
  const m = useSwarm.getState().mission;
  if (!m) return;
  steer({
    type: 'budget_updated',
    spentCents: m.spentCents,
    budgetCents: cents,
    stepCount: m.stepCount,
    maxSteps: m.maxSteps,
  });
  if (m.status === 'paused') steer({ type: 'mission_resumed' });
  steer({ type: 'intervention_applied', kind: 'raise_budget', taskId: null, note: `Budget raised to ${cents} cents` });
}

export function simKillTask(taskId: string): void {
  steer({ type: 'task_killed', taskId });
}

export function simApproveGate(taskId: string): void {
  steer({ type: 'intervention_applied', kind: 'approve', taskId, note: 'Approved by operator' });
  steer({ type: 'mission_resumed' });
}

export function simDenyGate(taskId: string): void {
  steer({ type: 'task_killed', taskId });
  // Mirror the live deny path: leave the held state at once via mission_resumed.
  steer({ type: 'mission_resumed' });
  steer({ type: 'intervention_applied', kind: 'deny', taskId, note: 'Denied by operator' });
}

export function simInjectNote(note: string): void {
  steer({ type: 'intervention_applied', kind: 'inject', taskId: null, note });
}
