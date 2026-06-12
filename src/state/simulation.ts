import type { Mission, SwarmEvent, SwarmEventRecord } from '../lib/types';
import { useSwarm } from './swarm';

/**
 * Local mission simulation. Replays a scripted swarm run through the same
 * applyEvent path the realtime channel uses, so the scene and overlay can be
 * built and demoed without the backend. Also exercised by unit tests.
 */

const T = {
  research: 'task-research',
  audience: 'task-audience',
  channels: 'task-channels',
  copy: 'task-copy',
  plan: 'task-plan',
};

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
    [4200, { type: 'task_claimed', taskId: T.research, agent: 'worker-1' }],
    [4400, { type: 'task_claimed', taskId: T.audience, agent: 'worker-2' }],
    [5200, { type: 'agent_thought', agent: 'worker-1', taskId: T.research, text: 'Scanning comparable products: positioning, pricing, launch angles.' }],
    [5900, { type: 'agent_thought', agent: 'worker-2', taskId: T.audience, text: 'Primary segment looks like indie builders who want delegation with oversight.' }],
    [7000, { type: 'memory_stored', agent: 'worker-1', memoryId: 'm1', summary: 'Competitors lead with speed, none lead with transparency.' }],
    [8200, { type: 'task_completed', taskId: T.research, agent: 'worker-1', summary: 'Landscape mapped; transparency is the open angle.' }],
    [8900, { type: 'memory_stored', agent: 'worker-2', memoryId: 'm2', summary: 'Audience: builders who distrust black-box agents.' }],
    [9600, { type: 'task_completed', taskId: T.audience, agent: 'worker-2', summary: 'Audience defined with three personas.' }],
    [10400, { type: 'task_reviewed', taskId: T.research, verdict: 'accepted', feedback: '' }],
    [11000, { type: 'task_reviewed', taskId: T.audience, verdict: 'accepted', feedback: '' }],
    [11600, { type: 'task_claimed', taskId: T.channels, agent: 'worker-3' }],
    [11800, { type: 'task_claimed', taskId: T.copy, agent: 'worker-1' }],
    [12600, { type: 'memory_recalled', agent: 'worker-1', taskId: T.copy, memoryIds: ['m1', 'm2'] }],
    [13400, { type: 'agent_thought', agent: 'worker-1', taskId: T.copy, text: 'Recalled: transparency is the wedge. Leading the copy with "watch it think."' }],
    [14600, { type: 'task_completed', taskId: T.channels, agent: 'worker-3', summary: 'Channels: launch video, builder communities, founder network.' }],
    [15400, { type: 'task_completed', taskId: T.copy, agent: 'worker-1', summary: 'Announcement drafted around live agent transparency.' }],
    [16200, { type: 'task_reviewed', taskId: T.channels, verdict: 'accepted', feedback: '' }],
    [17000, { type: 'task_reviewed', taskId: T.copy, verdict: 'rejected', feedback: 'Too feature-led. Open with the problem.' }],
    [17800, { type: 'task_claimed', taskId: T.copy, agent: 'worker-1' }],
    [18600, { type: 'agent_thought', agent: 'worker-1', taskId: T.copy, text: 'Rewriting: problem first, proof second, product third.' }],
    [20000, { type: 'task_completed', taskId: T.copy, agent: 'worker-1', summary: 'Copy rewritten, problem-first.' }],
    [20800, { type: 'task_reviewed', taskId: T.copy, verdict: 'accepted', feedback: '' }],
    [21400, { type: 'task_claimed', taskId: T.plan, agent: 'assembler' }],
    [22400, { type: 'agent_thought', agent: 'assembler', taskId: T.plan, text: 'Composing accepted outputs into the final launch plan.' }],
    [24000, { type: 'task_completed', taskId: T.plan, agent: 'assembler', summary: 'Launch plan assembled.' }],
    [24600, { type: 'task_reviewed', taskId: T.plan, verdict: 'accepted', feedback: '' }],
    [25400, { type: 'artifact_created', url: '#demo-artifact', name: 'launch-plan.md' }],
    [26200, { type: 'mission_completed' }],
  ];
}

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
  };
  useSwarm.getState().startMission(mission);

  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const [i, [delay, event]] of script(goal).entries()) {
    timers.push(
      setTimeout(() => {
        const record: SwarmEventRecord = {
          id: `sim-${i}`,
          missionId: mission.id,
          seq: i + 1,
          event,
          createdAt: new Date().toISOString(),
        };
        useSwarm.getState().applyEvent(record);
      }, delay),
    );
  }
  return { stop: () => timers.forEach(clearTimeout) };
}
