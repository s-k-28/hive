// HIVE orchestrator: the tick / brain of the swarm.
//
// Invoked by (a) the browser once, right after creating a mission, (b) the
// browser again after each steering intervention (approve a gate, resume, etc.),
// and (c) a 1 minute cron heartbeat as a safety net. Body: { missionId }.
//
// Execution model (important): on InsForge Deno Subhosting a called function only
// runs while the caller awaits its request; a fire-and-forget call is dropped.
// So the orchestrator AWAITS every agent-run it dispatches, and drives the whole
// mission in a bounded loop within a single invocation, rather than relying on
// the callee to call back. One invocation advances the mission as far as it can,
// then returns when the mission pauses at a gate, completes, fails, or the pass
// cap is reached. The browser's initial kick and its post-intervention kicks,
// plus the cron sweep, re-invoke to continue across pauses or a timeout. Work so
// far is always persisted, and every transition is a guarded atomic UPDATE, so
// re-invocation is idempotent and race-safe.
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

// Dispatch a call to another function and AWAIT it fully. On InsForge Deno
// Subhosting the callee only runs while the caller awaits the request, so we must
// await the response (the callee finishes its work and returns), bounded by a
// generous safety timeout against a genuinely hung callee. The orchestrator drives
// the mission in a loop, so callees never call back.
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
  const timeoutMs = Number(Deno.env.get("DISPATCH_TIMEOUT_MS") ?? "90000");
  try {
    const res = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-token": token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) console.error("dispatch non-ok", path, res.status);
  } catch (e) {
    console.error("dispatch error", path, e instanceof Error ? e.message : String(e));
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
  budget_cents: number | null;
  spent_cents: number;
  step_count: number;
  max_steps: number | null;
  guidance: string | null;
}

interface TaskRow {
  id: string;
  status: string;
  depends_on: string[];
  assignee: string | null;
  order_index: number;
  risk: boolean;
  risk_approved: boolean;
}

interface InterventionRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

// --- steering control plane -----------------------------------------------
//
// Drain and apply pending interventions for one mission, oldest first. Each is
// marked applied = true (admin client bypasses RLS for this write) and its
// effect applied to mission/task state, then an intervention_applied event is
// emitted so the cockpit log reflects the action. Returns the count applied so
// the caller knows to re-load state before ticking. Best effort per row: one bad
// payload is logged and skipped, it never aborts the drain.
async function consumeInterventions(
  db: ReturnType<typeof admin>,
  missionId: string,
  mission: MissionRow,
  tasks: TaskRow[],
): Promise<number> {
  const { data: pending } = await db.database
    .from("interventions")
    .select("id, type, payload")
    .eq("mission_id", missionId)
    .eq("applied", false)
    .order("created_at", { ascending: true });
  const rows = (pending ?? []) as InterventionRow[];
  if (rows.length === 0) return 0;

  const byId = new Map(tasks.map((t) => [t.id, t]));
  let appliedCount = 0;

  for (const iv of rows) {
    // Atomically claim this intervention: only the tick that flips applied
    // false -> true proceeds, so overlapping ticks never double-apply.
    const { data: claimed } = await db.database
      .from("interventions")
      .update({ applied: true })
      .eq("id", iv.id)
      .eq("applied", false)
      .select();
    if (!claimed || claimed.length === 0) continue; // lost the race

    try {
      switch (iv.type) {
        case "pause": {
          await db.database
            .from("missions")
            .update({ status: "paused" })
            .eq("id", missionId)
            .in("status", ["planning", "running", "assembling"]);
          await emitEvent(db, missionId, "mission_paused", {});
          await emitEvent(db, missionId, "intervention_applied", {
            kind: "pause",
            taskId: null,
            note: null,
          });
          break;
        }
        case "resume": {
          // Resume to running, or planning if no tasks exist yet.
          const next = tasks.length === 0 ? "planning" : "running";
          await db.database
            .from("missions")
            .update({ status: next })
            .eq("id", missionId)
            .in("status", ["paused", "awaiting_input"]);
          await emitEvent(db, missionId, "mission_resumed", {});
          await emitEvent(db, missionId, "intervention_applied", {
            kind: "resume",
            taskId: null,
            note: null,
          });
          break;
        }
        case "raise_budget": {
          const cents = Number(iv.payload?.budgetCents ?? 0);
          await db.database
            .from("missions")
            .update({ budget_cents: cents })
            .eq("id", missionId);
          // If we were paused specifically on the budget gate, resume now.
          const { data: m } = await db.database
            .from("missions")
            .select("status, spent_cents, step_count, max_steps")
            .eq("id", missionId)
            .limit(1);
          const row = m?.[0] as
            | { status?: string; spent_cents?: number; step_count?: number; max_steps?: number | null }
            | undefined;
          if (row?.status === "paused" && cents > Number(row?.spent_cents ?? 0)) {
            await db.database
              .from("missions")
              .update({ status: tasks.length === 0 ? "planning" : "running" })
              .eq("id", missionId)
              .eq("status", "paused");
            await emitEvent(db, missionId, "mission_resumed", {});
          }
          await emitEvent(db, missionId, "budget_updated", {
            spentCents: Number(row?.spent_cents ?? 0),
            budgetCents: cents,
            stepCount: Number(row?.step_count ?? 0),
            maxSteps: row?.max_steps ?? null,
          });
          await emitEvent(db, missionId, "intervention_applied", {
            kind: "raise_budget",
            taskId: null,
            note: `Budget raised to ${cents} cents`,
          });
          break;
        }
        case "kill_task": {
          const taskId = String(iv.payload?.taskId ?? "");
          if (taskId) {
            await db.database
              .from("tasks")
              .update({ status: "killed", assignee: null })
              .eq("mission_id", missionId)
              .eq("id", taskId);
            await emitEvent(db, missionId, "task_killed", { taskId });
            await emitEvent(db, missionId, "intervention_applied", {
              kind: "kill_task",
              taskId,
              note: null,
            });
          }
          break;
        }
        case "approve_gate": {
          const taskId = String(iv.payload?.taskId ?? "");
          const task = byId.get(taskId);
          if (taskId && task) {
            await db.database
              .from("tasks")
              .update({ risk_approved: true })
              .eq("mission_id", missionId)
              .eq("id", taskId);
            // Clear the awaiting_input hold so the next tick dispatches it.
            await db.database
              .from("missions")
              .update({ status: "running" })
              .eq("id", missionId)
              .eq("status", "awaiting_input");
            await emitEvent(db, missionId, "mission_resumed", {});
            await emitEvent(db, missionId, "intervention_applied", {
              kind: "approve",
              taskId,
              note: null,
            });
          }
          break;
        }
        case "deny_gate": {
          const taskId = String(iv.payload?.taskId ?? "");
          if (taskId) {
            await db.database
              .from("tasks")
              .update({ status: "killed", assignee: null })
              .eq("mission_id", missionId)
              .eq("id", taskId);
            // Clear the awaiting_input hold; the next tick continues without it.
            await db.database
              .from("missions")
              .update({ status: "running" })
              .eq("id", missionId)
              .eq("status", "awaiting_input");
            await emitEvent(db, missionId, "task_killed", { taskId });
            // Emit mission_resumed so the cockpit leaves the held state at once,
            // symmetric with approve_gate (the reducer lifts awaiting_input only
            // on a resume event, not on task_killed alone).
            await emitEvent(db, missionId, "mission_resumed", {});
            await emitEvent(db, missionId, "intervention_applied", {
              kind: "deny",
              taskId,
              note: null,
            });
          }
          break;
        }
        case "inject": {
          const note = String(iv.payload?.note ?? "").slice(0, 500);
          if (note) {
            // Append to guidance so the planner/workers/assembler pick it up.
            const prior = mission.guidance ? `${mission.guidance}\n` : "";
            await db.database
              .from("missions")
              .update({ guidance: `${prior}${note}` })
              .eq("id", missionId);
            mission.guidance = `${prior}${note}`; // keep local snapshot coherent
            await emitEvent(db, missionId, "intervention_applied", {
              kind: "inject",
              taskId: null,
              note,
            });
          }
          break;
        }
        default:
          console.error("unknown intervention type", iv.type);
      }
      appliedCount += 1;
    } catch (e) {
      console.error("intervention apply failed", iv.type, e);
    }
  }
  return appliedCount;
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

  // No missionId: cron heartbeat acting as a sweep. dispatch awaits each now, so
  // the sweep genuinely drives every non-terminal mission forward (a missed
  // browser kick or a prior timeout cannot strand one). Held states are included
  // so a pending intervention still drains; the per-mission tick returns early if
  // it is still held after draining.
  if (!missionId) {
    const { data: live } = await db.database
      .from("missions")
      .select("id")
      .in("status", ["planning", "running", "assembling", "paused", "awaiting_input"]);
    const ids = ((live ?? []) as { id: string }[]).map((m) => m.id);
    for (const id of ids) await dispatch("orchestrator", { missionId: id });
    return json({ ok: true, swept: ids.length });
  }

  const loadMission = async (): Promise<MissionRow | null> => {
    const { data } = await db.database
      .from("missions")
      .select("id, status, budget_cents, spent_cents, step_count, max_steps, guidance")
      .eq("id", missionId)
      .limit(1);
    return (data?.[0] as MissionRow | undefined) ?? null;
  };
  const loadTasks = async (): Promise<TaskRow[]> => {
    const { data } = await db.database
      .from("tasks")
      .select("id, status, depends_on, assignee, order_index, risk, risk_approved")
      .eq("mission_id", missionId)
      .order("order_index", { ascending: true });
    return (data ?? []) as TaskRow[];
  };

  const dispatched: string[] = [];
  const MAX_PASSES = Number(Deno.env.get("ORCH_MAX_PASSES") ?? "24");

  // Drain any pending interventions once up front (the browser invokes this right
  // after inserting one). Applying mutates mission/task state; the loop below
  // re-loads on every pass, so it always ticks on fresh state.
  {
    const mission = await loadMission();
    if (!mission) return json({ ok: false, error: "mission not found" }, 404);
    const tasks = await loadTasks();
    await consumeInterventions(db, missionId, mission, tasks);
  }

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const mission = await loadMission();
    if (!mission) return json({ ok: false, error: "mission not found" }, 404);
    if (mission.status === "complete" || mission.status === "failed") {
      return json({ ok: true, dispatched, note: "terminal" });
    }
    // Held: a pause or awaiting-input hold is stop-the-world. We already drained
    // interventions above; if one resumed it, the status here is no longer held
    // and we fall through.
    if (mission.status === "paused" || mission.status === "awaiting_input") {
      return json({ ok: true, dispatched, note: mission.status });
    }

    const tasks = await loadTasks();

    // Budget gate: spend reached the budget, pause and ask the human.
    if (mission.budget_cents != null && mission.spent_cents >= mission.budget_cents) {
      const { data: flipped } = await db.database
        .from("missions")
        .update({ status: "paused" })
        .eq("id", missionId)
        .eq("status", mission.status)
        .select();
      if (flipped && flipped.length > 0) {
        await emitEvent(db, missionId, "gate_tripped", { kind: "budget", taskId: null });
      }
      return json({ ok: true, dispatched, note: "budget_gate" });
    }

    // Step gate: step cap reached, pause and ask the human.
    if (mission.max_steps != null && mission.step_count >= mission.max_steps) {
      const { data: flipped } = await db.database
        .from("missions")
        .update({ status: "paused" })
        .eq("id", missionId)
        .eq("status", mission.status)
        .select();
      if (flipped && flipped.length > 0) {
        await emitEvent(db, missionId, "gate_tripped", { kind: "steps", taskId: null });
      }
      return json({ ok: true, dispatched, note: "step_gate" });
    }

    // Defensive termination: a failed task can never become accepted, so fail the
    // mission terminally (the agent-run failure path also does this in-isolate).
    if (tasks.some((t) => t.status === "failed")) {
      const { data: flipped } = await db.database
        .from("missions")
        .update({ status: "failed" })
        .eq("id", missionId)
        .eq("status", mission.status)
        .select();
      if (flipped && flipped.length > 0) {
        const failed = tasks.find((t) => t.status === "failed");
        await emitEvent(db, missionId, "mission_failed", {
          reason: `Task ${failed?.id ?? "?"} failed`,
        });
      }
      return json({ ok: true, dispatched, note: "failed" });
    }

    // Bootstrap: no tasks yet. Emit mission_started + the roster exactly once
    // (guard: zero events), then dispatch and await the planner, which creates the
    // task rows. Loop to the next pass to claim the first workers on fresh state.
    if (tasks.length === 0) {
      const { count } = await db.database
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("mission_id", missionId);
      if ((count ?? 0) === 0) {
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
      if (mission.status === "planning") {
        await dispatch("agent-run", { role: "planner", missionId });
        dispatched.push("planner");
        continue; // planner created the tasks; re-load and proceed
      }
      return json({ ok: true, dispatched, note: "no-tasks" });
    }

    // Claim every ready pending task. Ready = all depends_on are accepted or
    // killed (a killed dependency neither blocks nor feeds). The risk gate holds
    // the mission for a high-impact task before any worker runs it. Claims are
    // atomic (guarded by status = 'pending'); only the winner dispatches.
    const accepted = new Set(tasks.filter((t) => t.status === "accepted").map((t) => t.id));
    const killed = new Set(tasks.filter((t) => t.status === "killed").map((t) => t.id));
    const busy = new Set(
      tasks
        .filter((t) => t.status === "running" && t.assignee)
        .map((t) => t.assignee as string),
    );
    let rr = 0;
    const nextWorker = (): string => {
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

    const work: Promise<void>[] = [];

    let gated = false;
    for (const task of tasks) {
      if (task.status !== "pending") continue;
      const ready = task.depends_on.every((dep) => accepted.has(dep) || killed.has(dep));
      if (!ready) continue;

      if (task.risk && !task.risk_approved) {
        const { data: held } = await db.database
          .from("missions")
          .update({ status: "awaiting_input" })
          .eq("id", missionId)
          .eq("status", "running")
          .select();
        if (held && held.length > 0) {
          await emitEvent(db, missionId, "gate_tripped", { kind: "risk", taskId: task.id });
        }
        gated = true;
        break;
      }

      const worker = nextWorker();
      const { data: claimed, error: claimErr } = await db.database
        .from("tasks")
        .update({ status: "running", assignee: worker })
        .eq("mission_id", missionId)
        .eq("id", task.id)
        .eq("status", "pending")
        .select();
      if (claimErr) {
        console.error("claim failed", task.id, claimErr);
        continue;
      }
      if (!claimed || claimed.length === 0) continue; // lost the race

      await emitEvent(db, missionId, "task_claimed", { taskId: task.id, agent: worker });
      // Dispatch the worker in parallel with its siblings; awaited below.
      work.push(dispatch("agent-run", { role: "worker", missionId, taskId: task.id }));
      dispatched.push(`worker:${task.id}`);
    }
    if (gated) {
      await Promise.all(work);
      return json({ ok: true, dispatched, note: "risk_gate" });
    }

    // Critics for every task awaiting review, in parallel. Each critic atomically
    // transitions review -> accepted / pending, so a duplicate critic no-ops.
    for (const task of tasks) {
      if (task.status !== "review") continue;
      work.push(dispatch("agent-run", { role: "critic", missionId, taskId: task.id }));
      dispatched.push(`critic:${task.id}`);
    }

    // Terminal sweep: when nothing is still runnable, assemble (if any task was
    // accepted) or fail (if everything was killed). Guarded flips fire once.
    const runnable = tasks.filter((t) => t.status !== "accepted" && t.status !== "killed");
    const anyAccepted = tasks.some((t) => t.status === "accepted");
    let assemblerDispatched = false;
    if (tasks.length > 0 && runnable.length === 0 && mission.status === "running") {
      if (anyAccepted) {
        const { data: claimed } = await db.database
          .from("missions")
          .update({ status: "assembling" })
          .eq("id", missionId)
          .eq("status", "running")
          .select();
        if (claimed && claimed.length > 0) {
          work.push(dispatch("agent-run", { role: "assembler", missionId }));
          dispatched.push("assembler");
          assemblerDispatched = true;
        }
      } else {
        const { data: flipped } = await db.database
          .from("missions")
          .update({ status: "failed" })
          .eq("id", missionId)
          .eq("status", "running")
          .select();
        if (flipped && flipped.length > 0) {
          await emitEvent(db, missionId, "mission_failed", {
            reason: "All tasks were killed; nothing to assemble.",
          });
        }
        await Promise.all(work);
        return json({ ok: true, dispatched, note: "failed" });
      }
    }

    // Run this pass's dispatched agent-runs to completion, then loop on fresh
    // state. If nothing was dispatched, there is no progress to make right now.
    await Promise.all(work);
    if (work.length === 0 && !assemblerDispatched) {
      return json({ ok: true, dispatched, note: "idle" });
    }
  }

  return json({ ok: true, dispatched, note: "max_passes" });
}
