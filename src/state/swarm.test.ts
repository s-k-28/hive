import { beforeEach, describe, expect, it } from 'vitest';
import { useSwarm, pruneFx } from './swarm';
import type { Mission, SwarmEvent } from '../lib/types';

/**
 * The swarm reducer is the heart of HIVE: it turns the append-only event stream
 * (whether from the live realtime channel or the local simulation) into the
 * scene and overlay state. These tests pin every event transition, the ordering
 * guard, the log cap, the one-shot effects, and reset. If any of these drift,
 * the live scene drifts with them, so the suite is a release gate.
 */

const MISSION: Mission = {
  id: 'm',
  goal: 'Test goal',
  status: 'planning',
  artifactUrl: null,
  createdAt: '1970-01-01T00:00:00.000Z',
  repo: null,
  budgetCents: 100,
  spentCents: 0,
  stepCount: 0,
  maxSteps: null,
  guidance: null,
};

let seq = 0;
function apply(event: SwarmEvent): void {
  seq += 1;
  useSwarm.getState().applyEvent({
    id: `e${seq}`,
    missionId: 'm',
    seq,
    event,
    createdAt: '1970-01-01T00:00:00.000Z',
  });
}

const PLAN: Extract<SwarmEvent, { type: 'plan_created' }> = {
  type: 'plan_created',
  tasks: [
    { id: 'research', title: 'Research', dependsOn: [] },
    { id: 'copy', title: 'Copy', dependsOn: ['research'] },
  ],
};

beforeEach(() => {
  seq = 0;
  useSwarm.getState().startMission({ ...MISSION });
});

describe('startMission', () => {
  it('seeds the mission and clears prior state', () => {
    apply({ type: 'memory_stored', agent: 'worker-1', memoryId: 'x', summary: 's' });
    useSwarm.getState().startMission({ ...MISSION, id: 'm2', goal: 'next' });
    const s = useSwarm.getState();
    expect(s.mission?.id).toBe('m2');
    expect(s.memoryCount).toBe(0);
    expect(s.log).toHaveLength(0);
    expect(s.lastSeq).toBe(0);
    expect(Object.keys(s.tasks)).toHaveLength(0);
  });

  it('mounts the full six-agent roster as idle', () => {
    const { agents } = useSwarm.getState();
    expect(Object.keys(agents)).toHaveLength(6);
    expect(agents['planner'].visual).toBe('idle');
    expect(agents['assembler'].visual).toBe('idle');
  });
});

describe('ordering guard', () => {
  it('ignores an event whose seq is not greater than lastSeq', () => {
    const rec = {
      id: 'dup',
      missionId: 'm',
      seq: 5,
      event: { type: 'memory_stored', agent: 'worker-1', memoryId: 'a', summary: 's' } as SwarmEvent,
      createdAt: '1970-01-01T00:00:00.000Z',
    };
    useSwarm.getState().applyEvent(rec);
    expect(useSwarm.getState().memoryCount).toBe(1);
    // Same seq again, and a lower seq: both ignored.
    useSwarm.getState().applyEvent(rec);
    useSwarm.getState().applyEvent({ ...rec, id: 'low', seq: 3 });
    expect(useSwarm.getState().memoryCount).toBe(1);
    expect(useSwarm.getState().lastSeq).toBe(5);
  });
});

describe('event transitions', () => {
  it('mission_started moves status to planning and logs', () => {
    apply({ type: 'mission_started', goal: 'Test goal' });
    const s = useSwarm.getState();
    expect(s.mission?.status).toBe('planning');
    expect(s.log.at(-1)?.text).toContain('Mission started');
  });

  it('agent_spawned keeps the agent idle and logs it online', () => {
    apply({ type: 'agent_spawned', agent: 'critic', role: 'critic' });
    expect(useSwarm.getState().agents['critic'].visual).toBe('idle');
    expect(useSwarm.getState().log.at(-1)?.agent).toBe('critic');
  });

  it('plan_created creates tasks, runs the mission, completes the planner', () => {
    apply(PLAN);
    const s = useSwarm.getState();
    expect(s.mission?.status).toBe('running');
    expect(Object.keys(s.tasks)).toHaveLength(2);
    expect(s.tasks['copy'].dependsOn).toEqual(['research']);
    expect(s.tasks['research'].orderIndex).toBe(0);
    expect(s.tasks['copy'].orderIndex).toBe(1);
    expect(s.agents['planner'].visual).toBe('complete');
  });

  it('task_claimed sets the task running and the agent thinking on that task', () => {
    apply(PLAN);
    apply({ type: 'task_claimed', taskId: 'research', agent: 'worker-1' });
    const s = useSwarm.getState();
    expect(s.tasks['research'].status).toBe('running');
    expect(s.tasks['research'].assignee).toBe('worker-1');
    expect(s.agents['worker-1'].visual).toBe('thinking');
    expect(s.agents['worker-1'].taskId).toBe('research');
  });

  it('agent_thought streams a thought line and keeps the agent thinking', () => {
    apply({ type: 'agent_thought', agent: 'worker-2', taskId: 'research', text: 'hmm' });
    const s = useSwarm.getState();
    expect(s.agents['worker-2'].visual).toBe('thinking');
    const last = s.log.at(-1);
    expect(last?.kind).toBe('thought');
    expect(last?.text).toBe('hmm');
  });

  it('memory_stored increments the constellation count', () => {
    apply({ type: 'memory_stored', agent: 'worker-1', memoryId: 'a', summary: 's1' });
    apply({ type: 'memory_stored', agent: 'worker-2', memoryId: 'b', summary: 's2' });
    expect(useSwarm.getState().memoryCount).toBe(2);
  });

  it('memory_recalled queues a one-shot recall thread effect', () => {
    apply({ type: 'memory_recalled', agent: 'worker-1', taskId: 'copy', memoryIds: ['a', 'b'] });
    const fx = useSwarm.getState().fx;
    expect(fx.recallThreads).toHaveLength(1);
    expect(fx.recallThreads[0]).toMatchObject({ agent: 'worker-1', count: 2 });
  });

  it('task_completed moves the task to review and frees the agent', () => {
    apply(PLAN);
    apply({ type: 'task_claimed', taskId: 'research', agent: 'worker-1' });
    apply({ type: 'task_completed', taskId: 'research', agent: 'worker-1', summary: 'done' });
    const s = useSwarm.getState();
    expect(s.tasks['research'].status).toBe('review');
    expect(s.tasks['research'].result).toBe('done');
    expect(s.agents['worker-1'].visual).toBe('complete');
    expect(s.agents['worker-1'].taskId).toBeNull();
  });

  it('task_reviewed accepted marks the task accepted', () => {
    apply(PLAN);
    apply({ type: 'task_reviewed', taskId: 'research', verdict: 'accepted', feedback: '' });
    expect(useSwarm.getState().tasks['research'].status).toBe('accepted');
  });

  it('task_reviewed rejected records feedback, pulses, and reddens the critic', () => {
    apply(PLAN);
    apply({ type: 'task_reviewed', taskId: 'copy', verdict: 'rejected', feedback: 'Open with the problem.' });
    const s = useSwarm.getState();
    expect(s.tasks['copy'].status).toBe('rejected');
    expect(s.tasks['copy'].feedback).toBe('Open with the problem.');
    expect(s.fx.rejectPulses).toHaveLength(1);
    expect(s.fx.rejectPulses[0].taskId).toBe('copy');
    expect(s.agents['critic'].visual).toBe('error');
  });

  it('task_failed marks the task failed and the agent errored', () => {
    apply(PLAN);
    apply({ type: 'task_failed', taskId: 'research', agent: 'worker-3', error: 'boom' });
    const s = useSwarm.getState();
    expect(s.tasks['research'].status).toBe('failed');
    expect(s.agents['worker-3'].visual).toBe('error');
    expect(s.log.at(-1)?.kind).toBe('error');
  });

  it('artifact_created stores the artifact and moves the mission to assembling', () => {
    apply({ type: 'artifact_created', url: 'https://x/launch-plan.md', name: 'launch-plan.md' });
    const s = useSwarm.getState();
    expect(s.artifact).toEqual({ url: 'https://x/launch-plan.md', name: 'launch-plan.md' });
    expect(s.mission?.status).toBe('assembling');
    expect(s.mission?.artifactUrl).toBe('https://x/launch-plan.md');
  });

  it('mission_completed completes the mission and latches the burst', () => {
    apply({ type: 'mission_completed' });
    const s = useSwarm.getState();
    expect(s.mission?.status).toBe('complete');
    expect(s.fx.burstAt).not.toBeNull();
  });

  it('mission_failed fails the mission with a reason', () => {
    apply({ type: 'mission_failed', reason: 'gateway 429' });
    const s = useSwarm.getState();
    expect(s.mission?.status).toBe('failed');
    expect(s.log.at(-1)?.text).toContain('gateway 429');
  });
});

describe('log cap', () => {
  it('never grows beyond the 200 line ceiling', () => {
    for (let i = 0; i < 260; i++) {
      apply({ type: 'agent_thought', agent: 'worker-1', taskId: null, text: `t${i}` });
    }
    const { log } = useSwarm.getState();
    expect(log.length).toBeLessThanOrEqual(200);
    // The newest line is retained.
    expect(log.at(-1)?.text).toBe('t259');
  });
});

describe('control tower events', () => {
  it('budget_updated advances spend, step count, and budget on the mission', () => {
    apply({ type: 'budget_updated', spentCents: 37, budgetCents: 100, stepCount: 4, maxSteps: 20 });
    const m = useSwarm.getState().mission;
    expect(m?.spentCents).toBe(37);
    expect(m?.budgetCents).toBe(100);
    expect(m?.stepCount).toBe(4);
    expect(m?.maxSteps).toBe(20);
  });

  it('gate_tripped budget pauses the mission and records the gate', () => {
    apply({ type: 'gate_tripped', kind: 'budget', taskId: null });
    const s = useSwarm.getState();
    expect(s.mission?.status).toBe('paused');
    expect(s.gate).toMatchObject({ kind: 'budget', taskId: null });
    expect(s.log.at(-1)?.kind).toBe('error');
  });

  it('gate_tripped steps pauses the mission', () => {
    apply({ type: 'gate_tripped', kind: 'steps', taskId: null });
    const s = useSwarm.getState();
    expect(s.mission?.status).toBe('paused');
    expect(s.gate?.kind).toBe('steps');
  });

  it('gate_tripped risk moves to awaiting_input and flags the task as risk', () => {
    apply(PLAN);
    apply({ type: 'gate_tripped', kind: 'risk', taskId: 'copy' });
    const s = useSwarm.getState();
    expect(s.mission?.status).toBe('awaiting_input');
    expect(s.gate).toMatchObject({ kind: 'risk', taskId: 'copy' });
    expect(s.tasks['copy'].risk).toBe(true);
  });

  it('mission_paused and mission_resumed toggle status and clear the gate', () => {
    apply({ type: 'gate_tripped', kind: 'budget', taskId: null });
    expect(useSwarm.getState().mission?.status).toBe('paused');
    apply({ type: 'mission_resumed' });
    const s = useSwarm.getState();
    expect(s.mission?.status).toBe('running');
    expect(s.gate).toBeNull();
  });

  it('mission_resumed only lifts paused or awaiting_input, not terminal states', () => {
    apply({ type: 'mission_completed' });
    apply({ type: 'mission_resumed' });
    expect(useSwarm.getState().mission?.status).toBe('complete');
  });

  it('mission_paused sets the paused status directly', () => {
    apply({ type: 'mission_paused' });
    expect(useSwarm.getState().mission?.status).toBe('paused');
    expect(useSwarm.getState().log.at(-1)?.text).toContain('paused');
  });

  it('task_killed marks the task killed, frees its assignee, and logs it', () => {
    apply(PLAN);
    apply({ type: 'task_claimed', taskId: 'research', agent: 'worker-1' });
    apply({ type: 'task_killed', taskId: 'research' });
    const s = useSwarm.getState();
    expect(s.tasks['research'].status).toBe('killed');
    expect(s.tasks['research'].assignee).toBeNull();
    expect(s.log.at(-1)?.text).toContain('killed');
  });

  it('task_killed clears a risk gate that was holding on that task', () => {
    apply(PLAN);
    apply({ type: 'gate_tripped', kind: 'risk', taskId: 'copy' });
    expect(useSwarm.getState().gate?.kind).toBe('risk');
    apply({ type: 'task_killed', taskId: 'copy' });
    expect(useSwarm.getState().gate).toBeNull();
  });

  it('intervention_applied appends a steering line to the log', () => {
    apply({ type: 'intervention_applied', kind: 'inject', taskId: null, note: 'Stay under budget' });
    const last = useSwarm.getState().log.at(-1);
    expect(last?.text).toContain('inject');
    expect(last?.text).toContain('Stay under budget');
  });
});

describe('focus and reset', () => {
  it('setFocus stores and clears the focused agent', () => {
    useSwarm.getState().setFocus('worker-2');
    expect(useSwarm.getState().focusAgent).toBe('worker-2');
    useSwarm.getState().setFocus(null);
    expect(useSwarm.getState().focusAgent).toBeNull();
  });

  it('reset returns the store to an empty mission-less state', () => {
    apply(PLAN);
    apply({ type: 'memory_stored', agent: 'worker-1', memoryId: 'a', summary: 's' });
    useSwarm.getState().reset();
    const s = useSwarm.getState();
    expect(s.mission).toBeNull();
    expect(Object.keys(s.tasks)).toHaveLength(0);
    expect(s.memoryCount).toBe(0);
    expect(s.focusAgent).toBeNull();
  });
});

describe('pruneFx', () => {
  it('drops recall threads older than the ttl but keeps fresh ones', () => {
    apply({ type: 'memory_recalled', agent: 'worker-1', taskId: 'copy', memoryIds: ['a'] });
    // Backdate the queued effect well beyond the ttl.
    const fx = useSwarm.getState().fx;
    useSwarm.setState({
      fx: { ...fx, recallThreads: [{ agent: 'worker-1', count: 1, at: performance.now() - 10_000 }] },
    });
    pruneFx(2500);
    expect(useSwarm.getState().fx.recallThreads).toHaveLength(0);
  });
});

describe('specialists', () => {
  it('sets the specialist on tasks carried by plan_created', () => {
    apply({
      type: 'plan_created',
      tasks: [
        {
          id: 'research',
          title: 'Research',
          dependsOn: [],
          specialist: { slug: 'product-trend-researcher', name: 'Trend Researcher', emoji: '🔭', division: 'product' },
        },
        { id: 'copy', title: 'Copy', dependsOn: ['research'] },
      ],
    });
    const { tasks } = useSwarm.getState();
    expect(tasks['research'].specialist?.name).toBe('Trend Researcher');
    // A task with no specialist in the payload stays null.
    expect(tasks['copy'].specialist).toBeNull();
  });

  it('assigns a specialist live via specialist_assigned and logs it', () => {
    apply(PLAN);
    expect(useSwarm.getState().tasks['research'].specialist).toBeNull();
    apply({
      type: 'specialist_assigned',
      taskId: 'research',
      specialist: { slug: 'marketing-growth-hacker', name: 'Growth Hacker', emoji: '🚀', division: 'marketing' },
    });
    const s = useSwarm.getState();
    expect(s.tasks['research'].specialist?.slug).toBe('marketing-growth-hacker');
    expect(s.log.some((l) => l.text.includes('Growth Hacker'))).toBe(true);
  });

  it('ignores specialist_assigned for an unknown task without throwing', () => {
    apply(PLAN);
    apply({
      type: 'specialist_assigned',
      taskId: 'nope',
      specialist: { slug: 'x', name: 'X', emoji: '', division: 'd' },
    });
    expect(useSwarm.getState().tasks['nope']).toBeUndefined();
  });
});
