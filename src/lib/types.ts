/**
 * The Hive swarm protocol.
 *
 * Single source of truth shared by the edge functions (Deno), the state
 * layer, and the 3D scene. The backend writes rows to the `events` table;
 * a database trigger publishes each row to the realtime channel
 * `mission:{missionId}`; the frontend reduces them into scene state.
 * Field names use camelCase in payloads and snake_case in table columns.
 */

export type AgentRole = 'planner' | 'worker' | 'critic' | 'assembler';

export type AgentName =
  | 'planner'
  | 'worker-1'
  | 'worker-2'
  | 'worker-3'
  | 'critic'
  | 'assembler';

export type MissionStatus =
  | 'planning'
  | 'running'
  | 'assembling'
  | 'complete'
  | 'failed';

export type TaskStatus =
  | 'pending'    // waiting on dependencies
  | 'running'    // claimed by a worker
  | 'review'     // completed, awaiting critic verdict
  | 'rejected'   // critic bounced it back; will be retried with feedback
  | 'accepted'   // critic approved
  | 'failed';    // exhausted retries

export interface Mission {
  id: string;
  goal: string;
  status: MissionStatus;
  artifactUrl: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  missionId: string;
  title: string;
  description: string;
  status: TaskStatus;
  dependsOn: string[];   // task ids that must be accepted first
  assignee: AgentName | null;
  result: string | null;
  feedback: string | null; // critic feedback when rejected
  attempts: number;
  orderIndex: number;
}

/** Visual state an agent orb can be in. Derived purely from events. */
export type AgentVisualState = 'idle' | 'thinking' | 'complete' | 'error';

// ---------------------------------------------------------------------------
// Events. Every row in `events` is one of these. `type` + `payload` columns.
// ---------------------------------------------------------------------------

export interface PlanTaskSummary {
  id: string;
  title: string;
  dependsOn: string[];
}

export type SwarmEvent =
  | { type: 'mission_started'; goal: string }
  | { type: 'agent_spawned'; agent: AgentName; role: AgentRole }
  | { type: 'plan_created'; tasks: PlanTaskSummary[] }
  | { type: 'task_claimed'; taskId: string; agent: AgentName }
  | { type: 'agent_thought'; agent: AgentName; taskId: string | null; text: string }
  | { type: 'memory_stored'; agent: AgentName; memoryId: string; summary: string }
  | { type: 'memory_recalled'; agent: AgentName; taskId: string; memoryIds: string[] }
  | { type: 'task_completed'; taskId: string; agent: AgentName; summary: string }
  | { type: 'task_reviewed'; taskId: string; verdict: 'accepted' | 'rejected'; feedback: string }
  | { type: 'task_failed'; taskId: string; agent: AgentName; error: string }
  | { type: 'artifact_created'; url: string; name: string }
  | { type: 'mission_completed' }
  | { type: 'mission_failed'; reason: string };

export type SwarmEventType = SwarmEvent['type'];

/** Envelope as delivered over realtime (mirrors the events table row). */
export interface SwarmEventRecord {
  id: string;
  missionId: string;
  seq: number;          // monotonic per mission, for ordering and replay
  event: SwarmEvent;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Scene mapping reference (binding for the 3D scene):
//   mission_started   -> core ignites
//   agent_spawned     -> orb fades in, takes orbit
//   plan_created      -> task graph bloom-in animation (signature #1)
//   task_claimed      -> beam connects agent orb to task node
//   agent_thought     -> thinking pulse + particle flow on beam (signature #2),
//                        text streams into mission log
//   memory_stored     -> new star ignites in constellation (signature #3)
//   memory_recalled   -> light thread from constellation stars to agent
//   task_completed    -> task node flash, beam retracts
//   task_reviewed     -> accepted: node turns solid green-gold
//                        rejected: red pulse travels critic -> task node
//   task_failed       -> red shockwave from agent orb
//   artifact_created  -> artifact chip appears in overlay
//   mission_completed -> full-scene bloom burst, then calm
//   mission_failed    -> scene dims, core gutters
// ---------------------------------------------------------------------------

export const AGENT_ROSTER: { name: AgentName; role: AgentRole }[] = [
  { name: 'planner', role: 'planner' },
  { name: 'worker-1', role: 'worker' },
  { name: 'worker-2', role: 'worker' },
  { name: 'worker-3', role: 'worker' },
  { name: 'critic', role: 'critic' },
  { name: 'assembler', role: 'assembler' },
];

export const ROLE_COLORS: Record<AgentRole, string> = {
  planner: '#f5b94a',   // gold
  worker: '#22d3ee',    // cyan
  critic: '#e34fd0',    // magenta
  assembler: '#9af57a', // green-gold
};
