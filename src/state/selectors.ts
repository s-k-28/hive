import { useShallow } from 'zustand/react/shallow';
import { useSwarm } from './swarm';
import type { LogLine } from './swarm';
import type { Task } from '../lib/types';

/**
 * Read-side selector hooks over the swarm store. Additive only: the store API in
 * swarm.ts is unchanged. Composed values use useShallow so panels do not
 * re-render on every unrelated event tick.
 */

/** Tasks in stable plan order. */
export function useTasksSorted(): Task[] {
  return useSwarm(
    useShallow((s) => Object.values(s.tasks).sort((a, b) => a.orderIndex - b.orderIndex)),
  );
}

export interface CostView {
  spentCents: number;
  budgetCents: number | null;
  stepCount: number;
  maxSteps: number | null;
  pct: number;
  over: boolean;
  near: boolean;
}

/** Budget and step accounting for the meter and the cost panel. */
export function useCost(): CostView | null {
  return useSwarm(
    useShallow((s) => {
      const m = s.mission;
      if (!m) return null;
      const budget = m.budgetCents;
      // Reflect accrued per-task cost immediately, even before the backend emits
      // the next budget_updated event, so the meter never lags behind the board.
      const taskSum = Object.values(s.tasks).reduce((a, t) => a + (t.costCents || 0), 0);
      const spent = Math.max(m.spentCents, taskSum);
      const pct = budget && budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
      const over = budget != null && spent >= budget;
      const near = budget != null && !over && pct >= 80;
      return {
        spentCents: spent,
        budgetCents: budget,
        stepCount: m.stepCount,
        maxSteps: m.maxSteps,
        pct,
        over,
        near,
      };
    }),
  );
}

/** Log lines filtered to a kind, for the Console tab (agent reasoning only). */
export function useLogByKind(kind: LogLine['kind']): LogLine[] {
  return useSwarm(useShallow((s) => s.log.filter((l) => l.kind === kind)));
}
