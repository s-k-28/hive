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
