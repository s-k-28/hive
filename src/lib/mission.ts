import type { Mission, SwarmEvent, SwarmEventRecord, Task } from './types';
import { useSwarm } from '../state/swarm';
import {
  runSimulation,
  simApproveGate,
  simDenyGate,
  simInjectNote,
  simKillTask,
  simPause,
  simRaiseBudget,
  simResume,
} from '../state/simulation';
import { getClient } from './insforge';

/**
 * Mission launch and the steering control plane. The single entry point the UI
 * calls. In live mode it creates a mission row, subscribes to that mission's
 * realtime channel, kicks the orchestrator, and pipes every published event into
 * the swarm store. In dev mode (no InsForge project configured) it runs the
 * local simulation. Both feed the same applyEvent reducer.
 *
 * Steering (4.5): each control inserts an intervention row via the SDK, then
 * invokes the orchestrator once so it applies immediately rather than waiting
 * for the cron heartbeat. The orchestrator drains pending interventions at the
 * top of its tick (see functions/orchestrator.ts) and emits the matching event,
 * which the realtime channel streams back here. In dev mode the same calls route
 * to the simulation so the cockpit works fully offline.
 */

export interface MissionHandle {
  stop: () => void;
}

interface MissionRow {
  id: string;
  goal?: string;
  status?: string;
  created_at?: string;
  budget_cents?: number | null;
  max_steps?: number | null;
}

/**
 * The shape a realtime message arrives in. The InsForge socket layer delivers
 * `{ meta, ...publishedPayload }`, spreading the published fields to the top
 * level (confirmed against the SDK SocketMessage schema). Our DB trigger
 * publishes { id, missionId, seq, type, payload, createdAt }, so those land
 * here at the top level. We keep a defensive fallback for a nested form.
 */
interface RealtimeEnvelope {
  meta?: { channel?: string };
  id?: string;
  missionId?: string;
  seq?: number;
  type?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

function toRecord(msg: RealtimeEnvelope): SwarmEventRecord | null {
  // Prefer the top level; fall back to a nested envelope if the layer wraps it.
  const top: RealtimeEnvelope | undefined =
    msg && typeof msg.type === 'string'
      ? msg
      : (msg?.payload as RealtimeEnvelope | undefined);
  if (!top || typeof top.type !== 'string') return null;

  const inner =
    top.payload && typeof top.payload === 'object'
      ? (top.payload as Record<string, unknown>)
      : {};
  const missionId = String(top.missionId ?? '');
  const seq = Number(top.seq ?? 0);

  return {
    id: String(top.id ?? `${missionId}-${seq}`),
    missionId,
    seq,
    event: { type: top.type, ...inner } as SwarmEvent,
    createdAt: String(top.createdAt ?? new Date().toISOString()),
  };
}

// The realtime 'event_created' listener is global per event name, so we
// register it once and route to whatever mission is currently active.
let listenerWired = false;

// The active live mission id, used by the steering helpers to target the
// orchestrator. Null in dev mode (the simulation owns steering there).
let activeMissionId: string | null = null;

export interface StartOptions {
  /** Per-mission cost budget in cents. Null or undefined means no budget gate. */
  budgetCents?: number | null;
  /** Step cap. Null or undefined means no step gate. */
  maxSteps?: number | null;
  /**
   * Initial guidance the swarm respects from the first tick. Used by the
   * conversational deck to thread prior turns into a new mission so the session
   * carries context forward.
   */
  guidance?: string | null;
}

export async function startMission(
  goal: string,
  options: StartOptions = {},
): Promise<MissionHandle> {
  const trimmed = goal.trim();
  const client = getClient();
  const budgetCents = options.budgetCents ?? null;
  const maxSteps = options.maxSteps ?? null;
  const guidance = options.guidance?.trim() || null;

  // Dev path: no project configured, replay the scripted mission locally.
  if (!client) {
    activeMissionId = null;
    const handle = runSimulation(trimmed);
    return { stop: handle.stop };
  }

  // Live path. Scope the mission to the signed-in user when there is one, so it
  // shows up in their history; anon missions are allowed (user_id null).
  let userId: string | null = null;
  try {
    const { data } = await client.auth.getCurrentUser();
    userId = (data as { user?: { id?: string } } | null)?.user?.id ?? null;
  } catch {
    // Not signed in; anon mission.
  }

  const insertRow: Record<string, unknown> = {
    goal: trimmed,
    status: 'planning',
    budget_cents: budgetCents,
    max_steps: maxSteps,
  };
  if (userId) insertRow.user_id = userId;
  if (guidance) insertRow.guidance = guidance;

  const response = await client.database
    .from('missions')
    .insert([insertRow])
    .select();

  const rows = response.data as MissionRow[] | null;
  const row = rows?.[0];
  if (response.error || !row) {
    const reason =
      (response.error as { message?: string } | null)?.message ?? 'unknown error';
    throw new Error(`Could not create mission: ${reason}`);
  }

  const mission: Mission = {
    id: row.id,
    goal: trimmed,
    status: 'planning',
    artifactUrl: null,
    createdAt: row.created_at ?? new Date().toISOString(),
    budgetCents,
    spentCents: 0,
    stepCount: 0,
    maxSteps,
    guidance,
  };
  useSwarm.getState().startMission(mission);
  activeMissionId = row.id;

  await client.realtime.connect();
  await client.realtime.subscribe(`mission:${row.id}`);

  if (!listenerWired) {
    listenerWired = true;
    client.realtime.on<RealtimeEnvelope>('event_created', (msg) => {
      const record = toRecord(msg);
      if (!record) return;
      const active = useSwarm.getState().mission;
      // Ignore stray events from other missions sharing the global listener.
      if (active && record.missionId && record.missionId !== active.id) return;
      useSwarm.getState().applyEvent(record);
    });
  }

  // Kick the first tick now rather than waiting for the cron heartbeat.
  await client.functions.invoke('orchestrator', { body: { missionId: row.id } });

  return {
    stop: () => client.realtime.unsubscribe(`mission:${row.id}`),
  };
}

// ---------------------------------------------------------------------------
// Steering control plane (4.5). Each helper inserts an intervention row then
// invokes the orchestrator once so it applies immediately. In dev mode the call
// routes to the simulation instead. All are best-effort and log on failure
// rather than throwing into a click handler.
// ---------------------------------------------------------------------------

type InterventionType =
  | 'pause'
  | 'resume'
  | 'raise_budget'
  | 'kill_task'
  | 'approve_gate'
  | 'deny_gate'
  | 'inject';

async function sendIntervention(
  type: InterventionType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const client = getClient();
  if (!client || !activeMissionId) return; // dev mode handles its own routing
  const missionId = activeMissionId;
  try {
    const { error } = await client.database
      .from('interventions')
      .insert([{ mission_id: missionId, type, payload }]);
    if (error) {
      console.error('[hive] intervention insert failed', type, error);
      return;
    }
    // Apply immediately; do not wait on the (longer) tick response.
    await client.functions.invoke('orchestrator', { body: { missionId } });
  } catch (err) {
    console.error('[hive] intervention failed', type, err);
  }
}

export function pauseMission(): void {
  if (!getClient()) return simPause();
  void sendIntervention('pause');
}

export function resumeMission(): void {
  if (!getClient()) return simResume();
  void sendIntervention('resume');
}

export function raiseBudget(cents: number): void {
  if (!getClient()) return simRaiseBudget(cents);
  void sendIntervention('raise_budget', { budgetCents: cents });
}

export function killTask(taskId: string): void {
  if (!getClient()) return simKillTask(taskId);
  void sendIntervention('kill_task', { taskId });
}

export function approveGate(taskId: string): void {
  if (!getClient()) return simApproveGate(taskId);
  void sendIntervention('approve_gate', { taskId });
}

export function denyGate(taskId: string): void {
  if (!getClient()) return simDenyGate(taskId);
  void sendIntervention('deny_gate', { taskId });
}

export function injectNote(note: string): void {
  const trimmed = note.trim();
  if (!trimmed) return;
  if (!getClient()) return simInjectNote(trimmed);
  void sendIntervention('inject', { note: trimmed });
}

// ---------------------------------------------------------------------------
// Auth helpers. Thin wrappers over the InsForge SDK so the UI never imports the
// client directly. In dev mode (no client) they resolve to a signed-out state.
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
}

function toUser(data: unknown): AuthUser | null {
  const u = (data as { user?: { id?: string; email?: string; name?: string } } | null)?.user;
  if (!u?.id) return null;
  return { id: u.id, email: u.email ?? null, name: u.name ?? null };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getCurrentUser();
    return toUser(data);
  } catch {
    return null;
  }
}

export async function signUp(
  email: string,
  password: string,
  name?: string,
): Promise<{ user: AuthUser | null; error: string | null }> {
  const client = getClient();
  if (!client) return { user: null, error: 'Auth is unavailable in offline mode.' };
  const { data, error } = await client.auth.signUp({ email, password, name });
  if (error) return { user: null, error: (error as { message?: string }).message ?? 'Sign up failed' };
  return { user: toUser(data), error: null };
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ user: AuthUser | null; error: string | null }> {
  const client = getClient();
  if (!client) return { user: null, error: 'Auth is unavailable in offline mode.' };
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { user: null, error: (error as { message?: string }).message ?? 'Sign in failed' };
  return { user: toUser(data), error: null };
}

export async function signOut(): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await client.auth.signOut();
  } catch (err) {
    console.error('[hive] sign out failed', err);
  }
}

// ---------------------------------------------------------------------------
// Mission history (4.7 MissionHistory). Lists the signed-in user's past
// missions and reopens one by replaying its persisted events in order.
// ---------------------------------------------------------------------------

export interface MissionSummary {
  id: string;
  goal: string;
  status: string;
  createdAt: string;
}

interface EventRow {
  id: string;
  mission_id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export async function listMyMissions(): Promise<MissionSummary[]> {
  const client = getClient();
  if (!client) return [];
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await client.database
    .from('missions')
    .select('id, goal, status, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    console.error('[hive] listMyMissions failed', error);
    return [];
  }
  return ((data ?? []) as MissionRow[]).map((m) => ({
    id: m.id,
    goal: m.goal ?? '',
    status: m.status ?? 'planning',
    createdAt: m.created_at ?? new Date().toISOString(),
  }));
}

export async function reopenMission(missionId: string): Promise<MissionHandle | null> {
  const client = getClient();
  if (!client) return null;

  const { data: missionData, error: mErr } = await client.database
    .from('missions')
    .select('id, goal, status, created_at, budget_cents, max_steps')
    .eq('id', missionId)
    .limit(1);
  const row = (missionData as MissionRow[] | null)?.[0];
  if (mErr || !row) {
    console.error('[hive] reopenMission: not found', mErr);
    return null;
  }

  const mission: Mission = {
    id: row.id,
    goal: row.goal ?? '',
    status: 'planning',
    artifactUrl: null,
    createdAt: row.created_at ?? new Date().toISOString(),
    budgetCents: row.budget_cents ?? null,
    spentCents: 0,
    stepCount: 0,
    maxSteps: row.max_steps ?? null,
    guidance: null,
  };
  useSwarm.getState().startMission(mission);
  activeMissionId = row.id;

  // Seed task rows so a completed mission renders its full graph immediately,
  // then replay the persisted event log in order to rebuild scene + log state.
  const { data: taskData } = await client.database
    .from('tasks')
    .select('mission_id, id, title, description, status, depends_on, assignee, result, feedback, attempts, order_index, cost_cents, risk, risk_approved')
    .eq('mission_id', missionId)
    .order('order_index', { ascending: true });
  const tasks = ((taskData ?? []) as Record<string, unknown>[]).map(
    (t): Task => ({
      id: String(t.id),
      missionId: String(t.mission_id),
      title: String(t.title ?? ''),
      description: String(t.description ?? ''),
      status: (t.status as Task['status']) ?? 'pending',
      dependsOn: (t.depends_on as string[]) ?? [],
      assignee: (t.assignee as Task['assignee']) ?? null,
      result: (t.result as string | null) ?? null,
      feedback: (t.feedback as string | null) ?? null,
      attempts: Number(t.attempts ?? 0),
      orderIndex: Number(t.order_index ?? 0),
      costCents: Number(t.cost_cents ?? 0),
      risk: Boolean(t.risk),
      riskApproved: Boolean(t.risk_approved),
    }),
  );
  if (tasks.length > 0) useSwarm.getState().setTasks(tasks);

  const { data: eventData } = await client.database
    .from('events')
    .select('id, mission_id, seq, type, payload, created_at')
    .eq('mission_id', missionId)
    .order('seq', { ascending: true });
  const events = (eventData ?? []) as EventRow[];
  for (const e of events) {
    useSwarm.getState().applyEvent({
      id: e.id,
      missionId: e.mission_id,
      seq: e.seq,
      event: { type: e.type, ...(e.payload ?? {}) } as SwarmEvent,
      createdAt: e.created_at,
    });
  }

  // Re-subscribe for any further live events (e.g. reopening a still-running
  // mission), routed through the same global listener wired in startMission.
  await client.realtime.connect();
  await client.realtime.subscribe(`mission:${missionId}`);
  if (!listenerWired) {
    listenerWired = true;
    client.realtime.on<RealtimeEnvelope>('event_created', (msg) => {
      const record = toRecord(msg);
      if (!record) return;
      const active = useSwarm.getState().mission;
      if (active && record.missionId && record.missionId !== active.id) return;
      useSwarm.getState().applyEvent(record);
    });
  }

  return { stop: () => client.realtime.unsubscribe(`mission:${missionId}`) };
}
