/**
 * Pure scene layout math. No React, no three side effects beyond Vector3
 * construction at module scope. Shared by orbs, the task graph, and edges so
 * every component agrees on where a given agent or task lives in world space.
 */

import * as THREE from 'three';
import type { AgentName, AgentRole, Task } from '../lib/types';
import { AGENT_ROSTER, ROLE_COLORS } from '../lib/types';

/** Where the energy core sits. Everything orbits or hangs off this. */
export const CORE_POSITION = new THREE.Vector3(0, 0, 0);

/** Per-agent orbit parameters, derived once from the roster order. */
export interface OrbitParams {
  name: AgentName;
  role: AgentRole;
  color: string;
  radius: number;
  /** angular speed, rad/s */
  speed: number;
  /** starting phase offset, rad */
  phase: number;
  /** vertical bob amplitude */
  incline: number;
}

const TAU = Math.PI * 2;

/**
 * Spread the six agents onto distinct rings. Planner sits closest and slowest
 * so it reads as the conductor; workers ring the middle; critic and assembler
 * ride the outer edge. Phases are evenly distributed so orbs never stack.
 */
export const ORBITS: OrbitParams[] = AGENT_ROSTER.map((a, i) => {
  const radius = 3.3 + i * 0.62;
  const dir = i % 2 === 0 ? 1 : -1;
  return {
    name: a.name,
    role: a.role,
    color: ROLE_COLORS[a.role],
    radius,
    speed: dir * (0.16 + (i % 3) * 0.035),
    phase: (i / AGENT_ROSTER.length) * TAU,
    incline: 0.45 + (i % 3) * 0.18,
  };
});

const ORBIT_BY_NAME = new Map(ORBITS.map((o) => [o.name, o]));

/** Resolve an orb world position for time `t` into `out` (no allocation). */
export function orbitPosition(o: OrbitParams, t: number, out: THREE.Vector3): THREE.Vector3 {
  const a = t * o.speed + o.phase;
  out.set(
    Math.cos(a) * o.radius,
    Math.sin(t * 0.5 + o.phase) * o.incline,
    Math.sin(a) * o.radius,
  );
  return out;
}

export function orbitFor(name: AgentName): OrbitParams | undefined {
  return ORBIT_BY_NAME.get(name);
}

// ---------------------------------------------------------------------------
// Task graph layout. Layered DAG: depth = longest dependency chain to a root,
// siblings spread horizontally on a ring below the core so beams arc cleanly.
// Stable for a given task set because it is derived only from ids + dependsOn.
// ---------------------------------------------------------------------------

export interface TaskLayout {
  id: string;
  position: THREE.Vector3;
  depth: number;
}

const GRAPH_TOP_Y = -1.4; // first layer hangs just under the core
const LAYER_GAP = 2.35; // vertical spacing between dependency layers
const RING_RADIUS = 4.6; // horizontal spread radius per layer
const RING_LIFT = 0.0; // kept flat; depth carries the vertical story

/** Compute dependency depth (memoized per call via the local cache map). */
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
    if (visiting.has(id)) return 0; // cycle guard, should not happen
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

/**
 * Lay tasks out into a layered ring stack. Returns a stable map id -> layout.
 * Sorting by orderIndex within a layer keeps sibling placement deterministic.
 */
export function layoutTasks(tasks: Task[]): Map<string, TaskLayout> {
  const out = new Map<string, TaskLayout>();
  if (tasks.length === 0) return out;

  const depths = computeDepths(tasks);
  const layers = new Map<number, Task[]>();
  for (const t of tasks) {
    const d = depths.get(t.id) ?? 0;
    const bucket = layers.get(d);
    if (bucket) bucket.push(t);
    else layers.set(d, [t]);
  }

  for (const [depth, bucket] of layers) {
    bucket.sort((a, b) => a.orderIndex - b.orderIndex);
    const n = bucket.length;
    const y = GRAPH_TOP_Y - depth * LAYER_GAP;
    // Tighten the ring on deeper, usually smaller, layers so it forms a funnel.
    const r = RING_RADIUS * (1 - depth * 0.12);
    for (let i = 0; i < n; i++) {
      // Spread siblings across an arc facing the camera (front hemisphere).
      const spread = n === 1 ? 0 : (i / (n - 1) - 0.5);
      const ang = -Math.PI / 2 + spread * Math.PI * 0.9;
      out.set(bucket[i].id, {
        id: bucket[i].id,
        depth,
        position: new THREE.Vector3(
          Math.cos(ang) * r,
          y + RING_LIFT,
          Math.sin(ang) * r + 1.2, // bias toward camera so the DAG faces us
        ),
      });
    }
  }
  return out;
}

/** Color a task node by its status. HDR values bloom; dim values do not. */
export function taskStatusColor(status: Task['status']): THREE.ColorRepresentation {
  switch (status) {
    case 'pending':
      return '#3b4a66';
    case 'running':
      return '#22d3ee';
    case 'review':
      return '#f5b94a';
    case 'accepted':
      return '#9af57a';
    case 'rejected':
      return '#ff2244';
    case 'failed':
      return '#7a1020';
  }
}
