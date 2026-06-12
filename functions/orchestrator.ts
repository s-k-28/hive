// HIVE orchestrator: the tick / brain of the swarm.
//
// Invoked by (a) the browser once, right after creating a mission, (b) the
// agent-run function after each step to advance the tick, and (c) a 1 minute
// cron heartbeat as a safety net. Every invocation is one idempotent,
// race-safe tick. Body: { missionId }.
//
// Idempotency and race-safety are achieved with guarded conditional UPDATEs
// (atomic claims) rather than read-then-write, so two overlapping ticks can
// never double-dispatch the same unit of work. Each transition documents its
// guard inline. Failed cron runs are not retried by the platform, which is fine
// because a later tick re-derives all pending work from table state.
//
// One file per function deploy: a tiny shared helper block is inlined below and
// duplicated in agent-run.ts. Keep the two copies in sync.

// npm: specifier per the InsForge functions runtime (Deno). If the npm:
// specifier is unavailable in your project, swap to the esm.sh fallback noted
// in docs/deploy.md.
import { createAdminClient } from "npm:@insforge/sdk";

// --- shared helpers (inlined; mirrored in agent-run.ts) -------------------

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-worker-token",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function admin() {
  // Both secrets are guaranteed set at deploy (see docs/deploy.md). Assert
  // non-null so the admin config types check under strict TypeScript.
  return createAdminClient({
    baseUrl: Deno.env.get("INSFORGE_URL")!,
    apiKey: Deno.env.get("INSFORGE_API_KEY")!,
  });
}

// Insert one event row. The trigger on public.events publishes it to the
// mission channel. type is the SwarmEvent type; payload is the rest of that
// SwarmEvent object (camelCase keys), so the frontend can rebuild it as
// { type, ...payload }.
async function emitEvent(
  db: ReturnType<typeof admin>,
  missionId: string,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.database
    .from("events")
    .insert([{ mission_id: missionId, type, payload }]);
  if (error) console.error("emitEvent failed", type, error);
}

// Dispatch a call to another function on the project. The function route is
// public, so we authenticate with the shared WORKER_TOKEN header.
//
// Delivery vs blocking: on Deno Subhosting an isolate can be torn down once the
// handler returns, which would drop a plain fire-and-forget fetch. So we AWAIT
// the request only long enough to guarantee the bytes are transmitted, then
// abort waiting for the (long, AI-bound) response. The callee has already
// received the request and runs to completion in its own isolate. This keeps
// the tick short without losing the dispatch. DISPATCH_WAIT_MS is the grace
// window; tune via env if the platform needs longer to accept a connection.
async function dispatch(
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const base = Deno.env.get("FUNCTIONS_BASE_URL");
  const token = Deno.env.get("WORKER_TOKEN") ?? "";
  if (!base) {
    console.error("FUNCTIONS_BASE_URL not set; cannot dispatch", path);
    return;
  }
  const waitMs = Number(Deno.env.get("DISPATCH_WAIT_MS") ?? "2500");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), waitMs);
  try {
    await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-token": token },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    // AbortError is expected (we deliberately stop waiting for the response).
    if (!(e instanceof DOMException && e.name === "AbortError")) {
      console.error("dispatch error", path, e);
    }
  } finally {
    clearTimeout(timer);
  }
}

const WORKER_NAMES = ["worker-1", "worker-2", "worker-3"] as const;

const ROSTER: { name: string; role: string }[] = [
  { name: "planner", role: "planner" },
  { name: "worker-1", role: "worker" },
  { name: "worker-2", role: "worker" },
  { name: "worker-3", role: "worker" },
  { name: "critic", role: "critic" },
  { name: "assembler", role: "assembler" },
];

// --- types (local, mirror the relevant DB columns) ------------------------

interface MissionRow {
  id: string;
  status: string;
}

interface TaskRow {
  id: string;
  status: string;
  depends_on: string[];
  assignee: string | null;
  order_index: number;
}

// --- the tick -------------------------------------------------------------

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let missionId: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    missionId = body?.missionId;
  } catch {
    // ignore, handled below
  }
  const db = admin();

  // No missionId: this is the cron heartbeat acting as a sweep. Re-tick every
  // non-terminal mission so a dropped ping can never strand one. Each fan-out is
  // a normal single-mission tick, so this is a genuine safety net, not a no-op.
  if (!missionId) {
    const { data: live } = await db.database
      .from("missions")
      .select("id")
      .in("status", ["planning", "running", "assembling"]);
    const ids = ((live ?? []) as { id: string }[]).map((m) => m.id);
    for (const id of ids) await dispatch("orchestrator", { missionId: id });
    return json({ ok: true, swept: ids.length });
  }

  // 1. Load mission. Terminal states short-circuit (idempotent): a stray cron
  //    tick or late agent-run ping after completion does nothing.
  const { data: missions, error: mErr } = await db.database
    .from("missions")
    .select("id, status")
    .eq("id", missionId)
    .limit(1);
  if (mErr) return json({ ok: false, error: mErr.message }, 500);
  const mission = (missions?.[0] as MissionRow | undefined) ?? null;
  if (!mission) return json({ ok: false, error: "mission not found" }, 404);
  if (mission.status === "complete" || mission.status === "failed") {
    return json({ ok: true, dispatched: [], note: "terminal" });
  }

  const dispatched: string[] = [];

  // 2. Load tasks for this mission once; all decisions below derive from this
  //    snapshot plus guarded UPDATEs.
  const { data: taskData, error: tErr } = await db.database
    .from("tasks")
    .select("id, status, depends_on, assignee, order_index")
    .eq("mission_id", missionId)
    .order("order_index", { ascending: true });
  if (tErr) return json({ ok: false, error: tErr.message }, 500);
  const tasks = (taskData ?? []) as TaskRow[];

  // 2b. Defensive termination. A failed task can never become accepted, so the
  //     mission can never complete. Fail it terminally. The agent-run failure
  //     path already does this in its own isolate; this is the belt-and-suspenders
  //     for any failed task that reaches a tick (for example via the sweep). The
  //     conditional UPDATE guard makes the mission_failed emit fire at most once.
  if (tasks.some((t) => t.status === "failed")) {
    const { data: flipped } = await db.database
      .from("missions")
      .update({ status: "failed" })
      .eq("id", missionId)
      .eq("status", mission.status) // atomic: only flip from the observed status
      .select();
    if (flipped && flipped.length > 0) {
      const failed = tasks.find((t) => t.status === "failed");
      await emitEvent(db, missionId, "mission_failed", {
        reason: `Task ${failed?.id ?? "?"} failed`,
      });
    }
    return json({ ok: true, dispatched: [], note: "failed" });
  }

  // 3. First-tick bootstrap. Guard: zero events for this mission. Emitting the
  //    roster and mission_started exactly once populates the scene before any
  //    planning. The hard guard against a second planner is the planner's own
  //    atomic planning -> running flip (see agent-run.ts), so even if two ticks
  //    both observed zero events in the same sub-second window (very unlikely
  //    given the invocation pattern), at most one planner actually plans. A
  //    duplicated mission_started / agent_spawned is cosmetically harmless: the
  //    frontend reducer keys on monotonic seq and re-applying agent_spawned just
  //    re-sets an orb to idle.
  if (tasks.length === 0) {
    const { count, error: cErr } = await db.database
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("mission_id", missionId);
    if (cErr) return json({ ok: false, error: cErr.message }, 500);

    if ((count ?? 0) === 0) {
      // mission_started carries the goal; load it now (kept out of the hot path
      // above to avoid selecting goal text on every tick).
      const { data: goalRows } = await db.database
        .from("missions")
        .select("goal")
        .eq("id", missionId)
        .limit(1);
      const goal = (goalRows?.[0]?.goal as string | undefined) ?? "";
      await emitEvent(db, missionId, "mission_started", { goal });
      for (const member of ROSTER) {
        await emitEvent(db, missionId, "agent_spawned", {
          agent: member.name,
          role: member.role,
        });
      }
    }

    // Dispatch the planner only while still in planning. The planner re-checks
    // and atomically claims (planning -> running) before doing any work.
    if (mission.status === "planning") {
      await dispatch("agent-run", { role: "planner", missionId });
      dispatched.push("planner");
    }
    return json({ ok: true, dispatched });
  }

  // 4. Claim every ready pending task. A task is ready when all of its
  //    depends_on slugs name an accepted task. The claim is an atomic UPDATE
  //    guarded by status = 'pending'; only the tick whose UPDATE actually
  //    changed the row proceeds, so a task can never be handed to two workers.
  const accepted = new Set(
    tasks.filter((t) => t.status === "accepted").map((t) => t.id),
  );
  // Workers already occupied this tick (running) so we round-robin the rest.
  const busy = new Set(
    tasks
      .filter((t) => t.status === "running" && t.assignee)
      .map((t) => t.assignee as string),
  );
  let rr = 0;
  const nextWorker = (): string => {
    // Prefer a free worker; if all three are busy, fall back to round-robin
    // (the claim guard still prevents double work, this only labels the orb).
    for (const name of WORKER_NAMES) {
      if (!busy.has(name)) {
        busy.add(name);
        return name;
      }
    }
    const name = WORKER_NAMES[rr % WORKER_NAMES.length];
    rr += 1;
    return name;
  };

  for (const task of tasks) {
    if (task.status !== "pending") continue;
    const ready = task.depends_on.every((dep) => accepted.has(dep));
    if (!ready) continue;

    const worker = nextWorker();
    const { data: claimed, error: claimErr } = await db.database
      .from("tasks")
      .update({ status: "running", assignee: worker })
      .eq("mission_id", missionId)
      .eq("id", task.id)
      .eq("status", "pending") // race guard: only the first claimer wins
      .select();
    if (claimErr) {
      console.error("claim failed", task.id, claimErr);
      continue;
    }
    if (!claimed || claimed.length === 0) continue; // lost the race; skip

    await emitEvent(db, missionId, "task_claimed", {
      taskId: task.id,
      agent: worker,
    });
    await dispatch("agent-run", { role: "worker", missionId, taskId: task.id });
    dispatched.push(`worker:${task.id}`);
  }

  // 5. Dispatch the critic for every task awaiting review. The critic itself
  //    atomically transitions review -> accepted / pending and only emits if it
  //    won that transition, so dispatching once per review task per tick is
  //    idempotent: a second critic invocation finds status != 'review' and
  //    no-ops. This keeps the orchestrator stateless about critic claims.
  for (const task of tasks) {
    if (task.status !== "review") continue;
    await dispatch("agent-run", { role: "critic", missionId, taskId: task.id });
    dispatched.push(`critic:${task.id}`);
  }

  // 6. If every task is accepted and we have not started assembly, claim the
  //    assembly atomically (running -> assembling) and dispatch the assembler.
  //    The conditional UPDATE guarantees only one tick triggers assembly.
  const allAccepted =
    tasks.length > 0 && tasks.every((t) => t.status === "accepted");
  if (allAccepted && mission.status === "running") {
    const { data: claimed } = await db.database
      .from("missions")
      .update({ status: "assembling" })
      .eq("id", missionId)
      .eq("status", "running") // guard: only one tick flips running -> assembling
      .select();
    if (claimed && claimed.length > 0) {
      await dispatch("agent-run", { role: "assembler", missionId });
      dispatched.push("assembler");
    }
  }

  return json({ ok: true, dispatched });
}
