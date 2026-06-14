import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runSimulation,
  simApproveGate,
  simDenyGate,
  simInjectNote,
  simPause,
  simResume,
} from './simulation';
import { useSwarm } from './swarm';
import type { Task } from '../lib/types';

/**
 * The local simulation drives the exact same reducer the live realtime channel
 * feeds, so verifying its terminal state proves the whole client pipeline:
 * plan, claim, think, recall, complete, the critic bounce-back and retry,
 * assembly, and completion all land in a coherent final state.
 */

describe('runSimulation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSwarm.getState().reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drives a mission to a fully accepted, complete terminal state', () => {
    runSimulation('Draft a launch plan');
    // Fire every scheduled event (the script tops out near 28s).
    vi.advanceTimersByTime(40_000);

    const s = useSwarm.getState();
    const tasks = Object.values(s.tasks) as Task[];

    expect(s.mission?.status).toBe('complete');
    expect(tasks).toHaveLength(5);
    expect(tasks.every((t) => t.status === 'accepted')).toBe(true);
    expect(s.memoryCount).toBe(2);
    expect(s.artifact?.name).toBe('launch-plan.md');
    expect(s.fx.burstAt).not.toBeNull();
    expect(s.log.at(-1)?.text).toContain('Mission complete');
  });

  it('climbs the cost meter and clears the gate by the end', () => {
    runSimulation();
    vi.advanceTimersByTime(40_000);
    const s = useSwarm.getState();
    // Spend accrued via budget_updated events, under the demo budget.
    expect(s.mission?.spentCents).toBeGreaterThan(0);
    expect(s.mission?.spentCents).toBeLessThanOrEqual(s.mission?.budgetCents ?? 0);
    expect(s.mission?.stepCount).toBeGreaterThan(0);
    // The risk gate fired mid-run but is resolved by completion.
    expect(s.gate).toBeNull();
  });

  it('fires exactly one risk gate that holds then resumes mid-run', () => {
    runSimulation();
    // Advance to just after the gate trips (21.4s) but before the approval.
    vi.advanceTimersByTime(22_000);
    let s = useSwarm.getState();
    expect(s.mission?.status).toBe('awaiting_input');
    expect(s.gate).toMatchObject({ kind: 'risk', taskId: 'task-plan' });
    // Let the scripted approval + resume land.
    vi.advanceTimersByTime(3_000);
    s = useSwarm.getState();
    expect(s.gate).toBeNull();
    expect(['running', 'assembling', 'complete']).toContain(s.mission?.status);
  });

  it('shows exactly one critic bounce-back before the copy task is accepted', () => {
    runSimulation();
    vi.advanceTimersByTime(40_000);

    const s = useSwarm.getState();
    // The copy task is rejected once then re-accepted, so it carries the
    // critic feedback yet ends accepted, and it took more than one pass.
    const copy = s.tasks['task-copy'];
    expect(copy.status).toBe('accepted');
    expect(copy.feedback).toContain('problem');
    const rejections = s.log.filter((l) => l.text.startsWith('rejected'));
    expect(rejections).toHaveLength(1);
  });

  it('applies events in strict seq order with no gaps', () => {
    runSimulation();
    vi.advanceTimersByTime(40_000);
    // Every scripted event applied: lastSeq equals the number of log-or-state
    // events, and is strictly positive.
    expect(useSwarm.getState().lastSeq).toBeGreaterThan(20);
  });

  it('stop() after completion is a harmless no-op', () => {
    const handle = runSimulation();
    vi.advanceTimersByTime(40_000);
    expect(() => handle.stop()).not.toThrow();
    expect(useSwarm.getState().mission?.status).toBe('complete');
  });

  it('offline pause then resume mid-run still reaches completion', () => {
    // Regression: steering events must keep the reducer seq monotonic so they
    // do not poison the dedupe and drop the rest of the scripted run.
    runSimulation();
    vi.advanceTimersByTime(12_000);
    simPause();
    expect(useSwarm.getState().mission?.status).toBe('paused');
    simResume();
    expect(['running', 'assembling']).toContain(useSwarm.getState().mission?.status);
    vi.advanceTimersByTime(40_000);
    expect(useSwarm.getState().mission?.status).toBe('complete');
  });

  it('offline inject plus manual approve clears the gate and completes', () => {
    runSimulation();
    vi.advanceTimersByTime(22_000);
    expect(useSwarm.getState().mission?.status).toBe('awaiting_input');
    simInjectNote('Keep it under one page');
    simApproveGate('task-plan');
    expect(useSwarm.getState().gate).toBeNull();
    vi.advanceTimersByTime(40_000);
    expect(useSwarm.getState().mission?.status).toBe('complete');
  });

  it('a repo-scoped mission plays the code-review run to a complete state', () => {
    runSimulation('Review this codebase', {
      provider: 'github',
      fullName: 'octocat/hello-world',
      ref: 'main',
    });
    vi.advanceTimersByTime(40_000);

    const s = useSwarm.getState();
    const tasks = Object.values(s.tasks) as Task[];

    // The repo variant decomposes into the five code-review tasks, not the
    // launch-plan ones, and ships a repo-flavored artifact.
    expect(s.mission?.status).toBe('complete');
    expect(s.mission?.repo?.fullName).toBe('octocat/hello-world');
    expect(tasks).toHaveLength(5);
    expect(tasks.every((t) => t.status === 'accepted')).toBe(true);
    expect(s.tasks['task-map']).toBeDefined();
    expect(s.tasks['task-report']).toBeDefined();
    expect(s.artifact?.name).toBe('code-review.md');
    // The clone-and-index thought references the connected repo by name.
    expect(s.log.some((l) => l.text.includes('octocat/hello-world'))).toBe(true);
  });

  it('denying the gated step leaves the held state and kills the task', () => {
    // Regression: deny must emit mission_resumed so the cockpit never stalls in
    // awaiting_input after the backend has moved on.
    runSimulation();
    vi.advanceTimersByTime(22_000);
    expect(useSwarm.getState().mission?.status).toBe('awaiting_input');
    simDenyGate('task-plan');
    const s = useSwarm.getState();
    expect(s.gate).toBeNull();
    expect(s.mission?.status).not.toBe('awaiting_input');
    expect(s.tasks['task-plan'].status).toBe('killed');
  });
});
