/* eslint-disable @typescript-eslint/no-explicit-any, no-useless-assignment --
   Deno edge function. It runs on the InsForge Deno runtime and is type-checked
   there at deploy, not by the browser app's TypeScript or ESLint. The single
   any is the OpenAI chat-params passthrough in chat(). */

// HIVE agent-run: the role-parametrized muscle of the swarm.
//
// One Deno function runs every agent role with a different prompt. Body:
//   { role: 'planner'|'worker'|'critic'|'assembler', missionId, taskId? }
// plus header x-worker-token, which must equal the WORKER_TOKEN secret (the
// function route is public, so the handler authenticates internal calls).
//
// After finishing, every role except the assembler fires a fire-and-forget call
// to the orchestrator to advance the tick. The assembler is terminal.
//
// Each role is wrapped in try/catch. A worker or critic failure marks the task
// failed and then fails the mission terminally (a task that cannot be accepted
// makes the mission uncompletable), emitting task_failed then mission_failed. A
// planner or assembler failure emits mission_failed. So the scene always shows a
// cause and always reaches a terminal state, and we never return a bare 500 with
// no event on the stream. Transient gateway errors are absorbed earlier by the
// per-call retry, so reaching this catch means a genuine, persistent failure.
//
// One file per function deploy: the shared helper block is inlined here and
// mirrored in orchestrator.ts. Keep the two copies in sync.

import { createAdminClient } from "npm:@insforge/sdk";
import OpenAI from "npm:openai";

// --- shared helpers (inlined; mirrored in orchestrator.ts) ----------------

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

// Advance the orchestrator after a step. The function route is public so we
// send the shared token. We await only long enough to guarantee the request is
// transmitted (the isolate may be torn down once this handler returns), then
// abort waiting for the orchestrator's response so we do not block on its tick.
async function pingOrchestrator(missionId: string): Promise<void> {
  const base = Deno.env.get("FUNCTIONS_BASE_URL");
  const token = Deno.env.get("WORKER_TOKEN") ?? "";
  if (!base) {
    console.error("FUNCTIONS_BASE_URL not set; cannot ping orchestrator");
    return;
  }
  const waitMs = Number(Deno.env.get("DISPATCH_WAIT_MS") ?? "2500");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), waitMs);
  try {
    await fetch(`${base}/orchestrator`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-token": token },
      body: JSON.stringify({ missionId }),
      signal: controller.signal,
    });
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) {
      console.error("ping orchestrator error", e);
    }
  } finally {
    clearTimeout(timer);
  }
}

function openai(): OpenAI {
  return new OpenAI({
    baseURL: Deno.env.get("AI_BASE_URL") || "https://openrouter.ai/api/v1",
    apiKey: Deno.env.get("OPENROUTER_API_KEY"),
    defaultHeaders: {
      "HTTP-Referer": "https://hive.insforge.app",
      "X-Title": "Hive",
    },
  });
}

// Retry a flaky async call a few times with a short linear backoff. Transient
// gateway errors (429 spend-cap bursts, 5xx, dropped sockets) are the most
// common cause of a step failing on a live run, so absorbing them here keeps a
// single hiccup from failing the whole mission.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

// A chat completion with retry. opts is the standard create() params; typed
// loose because this runs on Deno where the app tsconfig does not apply.
// deno-lint-ignore no-explicit-any
function chat(ai: OpenAI, opts: any): Promise<any> {
  return withRetry(() => ai.chat.completions.create(opts));
}

// Extract the first JSON array or object from possibly-prose model output.
// Models often wrap JSON in markdown fences or commentary; this finds the first
// balanced [...] (preferred) or {...} and parses it.
function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  // Strip a leading code fence if present.
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const candidates = [fenced, trimmed];
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      // fall through to bracket extraction
    }
  }
  for (const open of ["[", "{"]) {
    const close = open === "[" ? "]" : "}";
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) {
      const slice = trimmed.slice(start, end + 1);
      try {
        return JSON.parse(slice) as T;
      } catch {
        // try next bracket type
      }
    }
  }
  throw new Error("no parseable JSON in model output");
}

const firstLine = (s: string): string => {
  const line = (s ?? "").trim().split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.replace(/^#+\s*/, "").slice(0, 180).trim();
};

// Model defaults, all overridable via secrets.
const MODELS = {
  planner: () => Deno.env.get("AI_PLANNER_MODEL") || "openai/gpt-4o",
  worker: () => Deno.env.get("AI_WORKER_MODEL") || "anthropic/claude-3.5-haiku",
  critic: () => Deno.env.get("AI_CRITIC_MODEL") || "openai/gpt-4o",
  assembler: () => Deno.env.get("AI_ASSEMBLER_MODEL") || "openai/gpt-4o",
  embed: () => Deno.env.get("AI_EMBED_MODEL") || "openai/text-embedding-3-small",
};

// --- cost accounting (control tower 4.3) ----------------------------------
//
// Approximate published per-million-token rates in USD, by model id. These are
// rough and only need to be representative for the live cost meter; the exact
// numbers are not load-bearing. Unknown models fall back to a sane default so a
// new model never makes a step look free. Rates: [prompt, completion] per 1M.
const RATES_PER_MTOK: Record<string, [number, number]> = {
  "openai/gpt-4o": [2.5, 10],
  "openai/gpt-4o-mini": [0.15, 0.6],
  "anthropic/claude-3.5-haiku": [0.8, 4],
  "anthropic/claude-3.5-sonnet": [3, 15],
};
const DEFAULT_RATE: [number, number] = [1, 3];

// Cents for a completion, from usage tokens and the model actually used. Returns
// at least 1 cent for any real call so each step visibly costs something on the
// meter. Best effort: any malformed usage yields a small floor cost.
function costCentsFor(modelId: string, usage: unknown): number {
  const u = (usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
  const promptTok = Number(u.prompt_tokens ?? 0);
  const completionTok = Number(u.completion_tokens ?? 0);
  const [pIn, pOut] = RATES_PER_MTOK[modelId] ?? DEFAULT_RATE;
  const usd = (promptTok / 1_000_000) * pIn + (completionTok / 1_000_000) * pOut;
  const cents = Math.round(usd * 100);
  return Math.max(1, cents);
}

// Record the cost of one step: set the task's cost, increment the mission spend
// and step count, then emit budget_updated with the fresh totals so the cockpit
// meter advances live. Strictly best effort: an accounting failure is logged and
// swallowed so it can never fail the underlying task. Each agent-run counts as
// at least one step. taskId is null for the planner and assembler.
async function recordCost(
  db: ReturnType<typeof admin>,
  missionId: string,
  taskId: string | null,
  modelId: string,
  usage: unknown,
): Promise<void> {
  try {
    const cents = costCentsFor(modelId, usage);

    // Per-task cost: add to whatever the task already accrued (retries stack).
    if (taskId) {
      const { data: tRows } = await db.database
        .from("tasks")
        .select("cost_cents")
        .eq("mission_id", missionId)
        .eq("id", taskId)
        .limit(1);
      const prior = Number(tRows?.[0]?.cost_cents ?? 0);
      await db.database
        .from("tasks")
        .update({ cost_cents: prior + cents })
        .eq("mission_id", missionId)
        .eq("id", taskId);
    }

    // Mission totals: read, increment, write. A small race here only slightly
    // under-counts and self-corrects on the next step; the gate still trips.
    const { data: mRows } = await db.database
      .from("missions")
      .select("spent_cents, step_count, budget_cents, max_steps")
      .eq("id", missionId)
      .limit(1);
    const m = mRows?.[0] as
      | { spent_cents?: number; step_count?: number; budget_cents?: number | null; max_steps?: number | null }
      | undefined;
    const spent = Number(m?.spent_cents ?? 0) + cents;
    const steps = Number(m?.step_count ?? 0) + 1;
    await db.database
      .from("missions")
      .update({ spent_cents: spent, step_count: steps })
      .eq("id", missionId);

    await emitEvent(db, missionId, "budget_updated", {
      spentCents: spent,
      budgetCents: m?.budget_cents ?? null,
      stepCount: steps,
      maxSteps: m?.max_steps ?? null,
    });
  } catch (e) {
    console.error("recordCost failed (continuing)", e);
  }
}

// --- local row types ------------------------------------------------------

interface TaskRow {
  mission_id: string;
  id: string;
  title: string;
  description: string;
  status: string;
  depends_on: string[];
  assignee: string | null;
  result: string | null;
  feedback: string | null;
  attempts: number;
  order_index: number;
}

// A plan task as produced by the planner / stored in plan_created payload.
interface PlanTask {
  id: string;
  title: string;
  dependsOn: string[];
}

// --- handler --------------------------------------------------------------

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Authenticate the internal call.
  const token = req.headers.get("x-worker-token");
  if (!token || token !== Deno.env.get("WORKER_TOKEN")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const role: string | undefined = body?.role;
  const missionId: string | undefined = body?.missionId;
  const taskId: string | undefined = body?.taskId;
  if (!role || !missionId) {
    return json({ ok: false, error: "role and missionId required" }, 400);
  }

  const db = admin();

  try {
    // Each role does one unit of work and returns. The orchestrator awaits this
    // call and drives the next step in its own loop, so agent-run never calls
    // back (a fire-and-forget ping would be dropped by the runtime anyway).
    switch (role) {
      case "planner":
        await runPlanner(db, missionId);
        return json({ ok: true, role });

      case "worker":
        if (!taskId) return json({ ok: false, error: "taskId required" }, 400);
        await runWorker(db, missionId, taskId);
        return json({ ok: true, role });

      case "critic":
        if (!taskId) return json({ ok: false, error: "taskId required" }, 400);
        await runCritic(db, missionId, taskId);
        return json({ ok: true, role });

      case "assembler":
        await runAssembler(db, missionId);
        return json({ ok: true, role });

      default:
        return json({ ok: false, error: `unknown role ${role}` }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("agent-run failed", role, missionId, taskId, message);
    // Emit a meaningful failure event so the scene shows a cause, and converge
    // state so the mission does not hang.
    try {
      if ((role === "worker" || role === "critic") && taskId) {
        // Use the task's real assignee so the right orb shows the error, then
        // mark the task failed so the mission does not hang on it.
        let agent = role === "critic" ? "critic" : "worker-1";
        if (role === "worker") {
          const { data: rows } = await db.database
            .from("tasks")
            .select("assignee")
            .eq("mission_id", missionId)
            .eq("id", taskId)
            .limit(1);
          const assignee = rows?.[0]?.assignee as string | null | undefined;
          if (assignee) agent = assignee;
        }
        await db.database
          .from("tasks")
          .update({ status: "failed" })
          .eq("mission_id", missionId)
          .eq("id", taskId);
        await emitEvent(db, missionId, "task_failed", {
          taskId,
          agent,
          error: message.slice(0, 200),
        });
        // A failed task can never be accepted, so the mission can never
        // complete. Terminate it here, in this isolate, rather than relying on a
        // follow-up tick: a dropped orchestrator ping must never strand the
        // mission mid-run. The frontend then leaves the running state.
        await db.database
          .from("missions")
          .update({ status: "failed" })
          .eq("id", missionId)
          .neq("status", "complete");
        await emitEvent(db, missionId, "mission_failed", {
          reason: `Task ${taskId} failed: ${message.slice(0, 160)}`,
        });
      } else {
        await db.database
          .from("missions")
          .update({ status: "failed" })
          .eq("id", missionId);
        await emitEvent(db, missionId, "mission_failed", {
          reason: message.slice(0, 200),
        });
      }
    } catch (inner) {
      console.error("failed to record failure event", inner);
    }
    // Still 200 so the platform does not treat it as a retryable crash; the
    // failure is already on the event stream.
    return json({ ok: false, role, error: message });
  }
}

// --- planner --------------------------------------------------------------

async function runPlanner(
  db: ReturnType<typeof admin>,
  missionId: string,
): Promise<void> {
  // Idempotency guard: atomically claim the mission by flipping planning ->
  // running. Only the invocation that actually changed the row plans. A second
  // planner dispatch (cron + browser, or an overlapping tick) finds the mission
  // already running and no-ops, so we never produce two plans.
  const { data: claimed } = await db.database
    .from("missions")
    .update({ status: "running" })
    .eq("id", missionId)
    .eq("status", "planning")
    .select("id, goal");
  if (!claimed || claimed.length === 0) return; // someone else is planning
  const goal = (claimed[0]?.goal as string | undefined) ?? "";

  // Injected guidance, if a human added a constraint before planning ran.
  const { data: guideRows } = await db.database
    .from("missions")
    .select("guidance")
    .eq("id", missionId)
    .limit(1);
  const guidance = (guideRows?.[0]?.guidance as string | null | undefined) ?? null;

  const ai = openai();
  const system =
    "You are the Planner of an autonomous agent swarm. Decompose the user's " +
    "goal into 4 to 7 concrete, self-contained tasks that a small team can " +
    "execute and then assemble into one deliverable. Return STRICT JSON only: " +
    'an array of objects {"id": slug, "title": string, "dependsOn": [slug,...]}. ' +
    "Rules: id is a short lowercase slug (letters, digits, hyphens), unique in " +
    "the array; dependsOn lists ids of tasks that must finish first and forms a " +
    "DAG (no cycles); at least two tasks should have an empty dependsOn so work " +
    "can start in parallel; the final task should depend on the others and " +
    "represent the synthesis. No prose, no markdown, JSON array only.";

  const completion = await chat(ai, {
    model: MODELS.planner(),
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `Goal: ${goal}` +
          (guidance ? `\n\nOperator guidance to respect: ${guidance}` : ""),
      },
    ],
    temperature: 0.4,
  });
  const raw = completion.choices?.[0]?.message?.content ?? "";
  // Account for the planner step (no task; counts as a step). Best effort.
  await recordCost(db, missionId, null, completion.model ?? MODELS.planner(), completion.usage);
  let plan = extractJson<PlanTask[]>(raw);

  // Validate / sanitize: keep well-formed entries, normalize ids to slugs,
  // dedupe, clamp to 7, and rewrite dependsOn through the same normalization so
  // references survive (the AI may reference original ids, not normalized ones).
  if (!Array.isArray(plan)) throw new Error("planner did not return an array");
  const slugify = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "task";

  const cleaned = plan.filter(
    (t) => t && typeof t.id === "string" && typeof t.title === "string",
  );
  // Map every original id to its slug so dependency references can be rewritten.
  const idMap = new Map<string, string>();
  for (const t of cleaned) idMap.set(String(t.id), slugify(String(t.id)));

  const seen = new Set<string>();
  plan = cleaned
    .map((t) => ({
      id: idMap.get(String(t.id)) as string,
      title: String(t.title).slice(0, 200),
      dependsOn: Array.isArray(t.dependsOn)
        ? t.dependsOn
            .map((d) => idMap.get(String(d)) ?? slugify(String(d)))
            : [],
    }))
    .filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    })
    .slice(0, 7);
  if (plan.length === 0) throw new Error("planner produced no usable tasks");
  const ids = new Set(plan.map((t) => t.id));
  for (const t of plan) {
    // Drop self-references and dependencies on tasks that did not survive.
    t.dependsOn = Array.from(
      new Set(t.dependsOn.filter((d) => ids.has(d) && d !== t.id)),
    );
  }

  // Insert task rows (pending; order_index by array order). Tag exactly one
  // high-impact task risk = true so the risk gate fires on a real run: prefer
  // the synthesis (a task that others depend on, i.e. appears in some
  // dependsOn), else the last task. The orchestrator holds for human approval
  // before dispatching a risk task that is not yet approved.
  const dependedOn = new Set<string>();
  for (const t of plan) for (const d of t.dependsOn) dependedOn.add(d);
  // The synthesis is the final task: the one nothing else depends on, that has
  // the most dependencies. Fall back to the last task in plan order.
  let riskId = plan[plan.length - 1]?.id ?? null;
  let bestDeps = -1;
  for (const t of plan) {
    if (!dependedOn.has(t.id) && t.dependsOn.length > bestDeps) {
      bestDeps = t.dependsOn.length;
      riskId = t.id;
    }
  }

  const rows = plan.map((t, i) => ({
    mission_id: missionId,
    id: t.id,
    title: t.title,
    description: "",
    status: "pending",
    depends_on: t.dependsOn,
    order_index: i,
    risk: t.id === riskId,
  }));
  const { error: insErr } = await db.database.from("tasks").insert(rows);
  if (insErr) throw new Error(`failed to insert tasks: ${insErr.message}`);

  // One short reasoning line, then the plan. agent_thought for the planner uses
  // taskId: null (matches the SwarmEvent union). plan_created payload.tasks is
  // the PlanTaskSummary array with dependsOn in camelCase.
  await emitEvent(db, missionId, "agent_thought", {
    agent: "planner",
    taskId: null,
    text: `Decomposed the goal into ${plan.length} tasks with dependencies; parallel work can begin.`,
  });
  await emitEvent(db, missionId, "plan_created", {
    tasks: plan.map((t) => ({ id: t.id, title: t.title, dependsOn: t.dependsOn })),
  });
  // mission.status is already 'running' from the claim above; the frontend also
  // moves to running on plan_created.
}

// --- worker ---------------------------------------------------------------

async function runWorker(
  db: ReturnType<typeof admin>,
  missionId: string,
  taskId: string,
): Promise<void> {
  const { data: taskRows } = await db.database
    .from("tasks")
    .select("*")
    .eq("mission_id", missionId)
    .eq("id", taskId)
    .limit(1);
  const task = (taskRows?.[0] as TaskRow | undefined) ?? null;
  if (!task) throw new Error("task not found");
  const agent = (task.assignee as string | null) ?? "worker-1";

  const { data: missionRows } = await db.database
    .from("missions")
    .select("goal, guidance")
    .eq("id", missionId)
    .limit(1);
  const goal = (missionRows?.[0]?.goal as string | undefined) ?? "";
  const guidance = (missionRows?.[0]?.guidance as string | null | undefined) ?? null;

  const ai = openai();

  // Recall: embed the task, semantically search this mission's memories.
  let recalled: { id: string; summary: string; content: string }[] = [];
  try {
    const embedInput = `${task.title}\n${task.description ?? ""}`.trim();
    const emb = await ai.embeddings.create({
      model: MODELS.embed(),
      input: embedInput,
    });
    const queryEmbedding = emb.data?.[0]?.embedding;
    if (queryEmbedding) {
      const { data: matches } = await db.database.rpc("match_memories", {
        query_embedding: queryEmbedding,
        p_mission_id: missionId,
        match_count: 3,
      });
      recalled = (matches ?? []) as {
        id: string;
        summary: string;
        content: string;
      }[];
    }
  } catch (e) {
    // Recall is best-effort; a memory miss must never fail the task.
    console.error("recall failed (continuing)", e);
  }
  if (recalled.length > 0) {
    await emitEvent(db, missionId, "memory_recalled", {
      agent,
      taskId,
      memoryIds: recalled.map((m) => m.id),
    });
  }

  // Reason and produce the result. Include feedback if this is a retry.
  const memoryContext =
    recalled.length > 0
      ? "\n\nRelevant memories from teammates:\n" +
        recalled.map((m) => `- ${m.summary}: ${m.content}`).join("\n")
      : "";
  const retryNote =
    task.feedback && task.attempts > 0
      ? `\n\nThis task was previously returned by the reviewer. Address this feedback: ${task.feedback}`
      : "";
  const guidanceNote = guidance
    ? `\n\nOperator guidance to respect throughout: ${guidance}`
    : "";

  const system =
    "You are a Worker agent in an autonomous swarm. Complete exactly the one " +
    "task assigned, producing a concise, concrete, useful result in clean " +
    "markdown. Be specific and actionable; do not restate the prompt or pad. " +
    "Aim for tight, high-signal output (a few short paragraphs or a focused " +
    "list).";
  const user =
    `Overall mission goal: ${goal}\n\n` +
    `Your task: ${task.title}\n` +
    (task.description ? `Details: ${task.description}\n` : "") +
    memoryContext +
    retryNote +
    guidanceNote;

  const completion = await chat(ai, {
    model: MODELS.worker(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.6,
  });
  const result = (completion.choices?.[0]?.message?.content ?? "").trim();
  if (!result) throw new Error("worker produced empty result");

  // Account for this worker step. Best effort; never fails the task.
  await recordCost(db, missionId, taskId, completion.model ?? MODELS.worker(), completion.usage);

  // One short reasoning line for the live log.
  await emitEvent(db, missionId, "agent_thought", {
    agent,
    taskId,
    text: recalled.length
      ? `Recalled ${recalled.length} prior insight(s); drafting ${task.title}.`
      : `Working through ${task.title}.`,
  });

  // Write the result and move the task to review.
  const { error: upErr } = await db.database
    .from("tasks")
    .update({ status: "review", result })
    .eq("mission_id", missionId)
    .eq("id", taskId);
  if (upErr) throw new Error(`failed to write result: ${upErr.message}`);

  const summary = firstLine(result) || `Completed ${task.title}.`;
  await emitEvent(db, missionId, "task_completed", { taskId, agent, summary });

  // Store a memory of this result so later workers can recall it.
  try {
    const memSummary = summary.slice(0, 160);
    const memContent = result.slice(0, 2000);
    const memEmb = await ai.embeddings.create({
      model: MODELS.embed(),
      input: `${task.title}: ${memSummary}`,
    });
    const memVector = memEmb.data?.[0]?.embedding ?? null;
    const { data: memRows } = await db.database
      .from("memories")
      .insert([
        {
          mission_id: missionId,
          agent,
          summary: memSummary,
          content: memContent,
          embedding: memVector,
        },
      ])
      .select("id");
    const memoryId = (memRows?.[0]?.id as string | undefined) ?? "";
    if (memoryId) {
      await emitEvent(db, missionId, "memory_stored", {
        agent,
        memoryId,
        summary: memSummary,
      });
    }
  } catch (e) {
    // Memory write is best-effort; never fail the task because of it.
    console.error("memory store failed (continuing)", e);
  }
}

// --- critic ---------------------------------------------------------------

async function runCritic(
  db: ReturnType<typeof admin>,
  missionId: string,
  taskId: string,
): Promise<void> {
  const { data: taskRows } = await db.database
    .from("tasks")
    .select("*")
    .eq("mission_id", missionId)
    .eq("id", taskId)
    .limit(1);
  const task = (taskRows?.[0] as TaskRow | undefined) ?? null;
  if (!task) throw new Error("task not found");
  // Idempotency: only act on a task that is awaiting review. A duplicate critic
  // dispatch finds status != 'review' and no-ops.
  if (task.status !== "review") return;

  const { data: missionRows } = await db.database
    .from("missions")
    .select("goal")
    .eq("id", missionId)
    .limit(1);
  const goal = (missionRows?.[0]?.goal as string | undefined) ?? "";

  const ai = openai();
  const system =
    "You are the Critic of an autonomous swarm. Hold a high bar. Judge whether " +
    "the result genuinely and completely satisfies the task in service of the " +
    "mission goal. Return STRICT JSON only: " +
    '{"verdict": "accepted" | "rejected", "feedback": string}. ' +
    "Reject only when there is a concrete, fixable shortcoming, and put the " +
    "specific fix in feedback (one or two sentences). If it is genuinely solid, " +
    "accept with brief feedback. JSON object only, no prose, no markdown.";
  const user =
    `Mission goal: ${goal}\n\n` +
    `Task: ${task.title}\n\n` +
    `Result to review:\n${task.result ?? ""}`;

  const completion = await chat(ai, {
    model: MODELS.critic(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  });
  const raw = completion.choices?.[0]?.message?.content ?? "";
  // Account for the critic step against the task. Best effort.
  await recordCost(db, missionId, taskId, completion.model ?? MODELS.critic(), completion.usage);

  let verdict: "accepted" | "rejected" = "accepted";
  let feedback = "";
  try {
    const parsed = extractJson<{ verdict?: string; feedback?: string }>(raw);
    verdict = parsed.verdict === "rejected" ? "rejected" : "accepted";
    feedback = typeof parsed.feedback === "string" ? parsed.feedback.slice(0, 300) : "";
  } catch {
    // If the critic's JSON is unparseable, fail safe to accepted so the mission
    // converges rather than stalling.
    verdict = "accepted";
    feedback = "";
  }

  // Convergence cap: allow at most one retry. On a reject when attempts < 1,
  // requeue the task (pending, attempts+1, feedback, assignee cleared). On a
  // reject when attempts >= 1, accept anyway so the mission cannot loop forever.
  if (verdict === "rejected" && task.attempts < 1) {
    const { data: bounced } = await db.database
      .from("tasks")
      .update({
        status: "pending",
        attempts: task.attempts + 1,
        feedback,
        assignee: null,
        result: null,
      })
      .eq("mission_id", missionId)
      .eq("id", taskId)
      .eq("status", "review") // atomic: only transition if still in review
      .select();
    if (!bounced || bounced.length === 0) return; // lost the race
    await emitEvent(db, missionId, "task_reviewed", {
      taskId,
      verdict: "rejected",
      feedback,
    });
    return;
  }

  // Accept (either a genuine accept, or a forced convergence after one retry).
  const note =
    verdict === "rejected"
      ? feedback
        ? `Converged after retry. ${feedback}`.slice(0, 300)
        : "Converged after retry."
      : feedback;
  const { data: acceptedRows } = await db.database
    .from("tasks")
    .update({ status: "accepted", feedback: note })
    .eq("mission_id", missionId)
    .eq("id", taskId)
    .eq("status", "review") // atomic guard
    .select();
  if (!acceptedRows || acceptedRows.length === 0) return; // lost the race
  await emitEvent(db, missionId, "task_reviewed", {
    taskId,
    verdict: "accepted",
    feedback: note,
  });
}

// --- assembler ------------------------------------------------------------

async function runAssembler(
  db: ReturnType<typeof admin>,
  missionId: string,
): Promise<void> {
  const { data: missionRows } = await db.database
    .from("missions")
    .select("goal, status, guidance")
    .eq("id", missionId)
    .limit(1);
  const mission = missionRows?.[0] as { goal: string; status: string; guidance?: string | null } | undefined;
  if (!mission) throw new Error("mission not found");
  // Idempotency: the orchestrator already flipped running -> assembling and only
  // one tick wins that flip, so only one assembler runs. If somehow re-invoked
  // after completion, bail.
  if (mission.status === "complete") return;
  const goal = mission.goal ?? "";
  const guidance = mission.guidance ?? null;

  const { data: taskRows } = await db.database
    .from("tasks")
    .select("id, title, result, order_index, status")
    .eq("mission_id", missionId)
    .order("order_index", { ascending: true });
  const tasks = (taskRows ?? []) as Pick<
    TaskRow,
    "id" | "title" | "result" | "order_index" | "status"
  >[];
  const accepted = tasks.filter((t) => t.status === "accepted");

  const ai = openai();
  const system =
    "You are the Assembler of an autonomous swarm. Compose the accepted task " +
    "outputs into a single cohesive, well-structured deliverable in clean " +
    "markdown. Open with a short title and a one-paragraph overview, then weave " +
    "the parts into a logical document with clear headings. Remove redundancy, " +
    "smooth transitions, and keep it concrete. Output only the final markdown.";
  const parts = accepted
    .map((t) => `## ${t.title}\n\n${t.result ?? ""}`)
    .join("\n\n");
  const user = `Mission goal: ${goal}\n\nAccepted work to assemble:\n\n${parts}` +
    (guidance ? `\n\nOperator guidance to respect: ${guidance}` : "");

  const completion = await chat(ai, {
    model: MODELS.assembler(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.5,
  });
  const artifact = (completion.choices?.[0]?.message?.content ?? "").trim() ||
    `# Mission deliverable\n\n${parts}`;
  // Account for the assembler step (mission-level; no single task). Best effort.
  await recordCost(db, missionId, null, completion.model ?? MODELS.assembler(), completion.usage);

  // Upload to the artifacts bucket. The bucket must already exist (created out
  // of band; see docs/deploy.md). upload() returns { data: { url, key, ... } }.
  const name = "launch-plan.md";
  const key = `missions/${missionId}/${name}`;
  const file = new File([artifact], name, { type: "text/markdown" });
  const { data: uploaded, error: upErr } = await db.storage
    .from("artifacts")
    .upload(key, file);
  if (upErr || !uploaded?.url) {
    throw new Error(`artifact upload failed: ${upErr?.message ?? "no url"}`);
  }
  const url = uploaded.url;

  // Finalize the mission.
  const { error: missErr } = await db.database
    .from("missions")
    .update({ status: "complete", artifact_url: url })
    .eq("id", missionId);
  if (missErr) throw new Error(`failed to finalize mission: ${missErr.message}`);

  await emitEvent(db, missionId, "artifact_created", { url, name });
  await emitEvent(db, missionId, "mission_completed", {});
  // Terminal: no orchestrator ping.
}
