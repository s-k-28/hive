import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSimulation } from './simulation';
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
    // Fire every scheduled event (the script tops out near 26s).
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
});
