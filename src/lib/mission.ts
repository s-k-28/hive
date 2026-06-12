import type { Mission, SwarmEvent, SwarmEventRecord } from './types';
import { useSwarm } from '../state/swarm';
import { runSimulation } from '../state/simulation';
import { getClient } from './insforge';

/**
 * Mission launch. The single entry point the UI calls. In live mode it creates
 * a mission row, subscribes to that mission's realtime channel, kicks the
 * orchestrator, and pipes every published event into the swarm store. In dev
 * mode (no InsForge project configured) it runs the local simulation. Both
 * feed the same applyEvent reducer.
 */

export interface MissionHandle {
  stop: () => void;
}

interface MissionRow {
  id: string;
  goal?: string;
  status?: string;
  created_at?: string;
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

export async function startMission(goal: string): Promise<MissionHandle> {
  const trimmed = goal.trim();
  const client = getClient();

  // Dev path: no project configured, replay the scripted mission locally.
  if (!client) {
    const handle = runSimulation(trimmed);
    return { stop: handle.stop };
  }

  // Live path.
  const response = await client.database
    .from('missions')
    .insert([{ goal: trimmed, status: 'planning' }])
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
  };
  useSwarm.getState().startMission(mission);

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
