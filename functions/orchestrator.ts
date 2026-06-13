/* eslint-disable @typescript-eslint/no-explicit-any, no-useless-assignment --
   Deno edge function. It runs on the InsForge Deno runtime and is type-checked
   there at deploy, not by the browser app's TypeScript or ESLint. The single
   any is the OpenAI chat-params passthrough in chat(). */

// HIVE orchestrator: the single edge function that runs the whole swarm.
//
// InsForge blocks one edge function from invoking another (HTTP 508), so this one
// function runs the agent role logic inline. The browser kicks it with
// { missionId } (and re-kicks after each steering intervention); the cron hits it
// body-less to sweep every non-terminal mission. It drives one mission forward in
// a bounded loop, awaiting each role, until the mission pauses at a gate,
// completes, fails, or the pass cap is hit. Every transition is a guarded atomic
// UPDATE, so re-invocation is idempotent and race-safe. See docs/deploy.md.

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
  risk: boolean;
  risk_approved: boolean;
  cost_cents: number;
}

// A plan task as produced by the planner / stored in plan_created payload.
interface PlanTask {
  id: string;
  title: string;
  dependsOn: string[];
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


// --- role execution (inline) ----------------------------------------------
//
// The orchestrator runs each role directly in this same isolate (InsForge blocks
// one edge function from calling another, so there is no separate agent-run).
// Failure handling that used to live in the agent-run handler is here: a thrown
// role error marks the task failed (worker/critic) and fails the mission, or
// fails the mission directly (planner/assembler), so a mission always terminates.
async function runRole(
  db: ReturnType<typeof admin>,
  missionId: string,
  role: string,
  taskId: string | null,
): Promise<void> {
  try {
    if (role === "planner") await runPlanner(db, missionId);
    else if (role === "worker") await runWorker(db, missionId, taskId as string);
    else if (role === "critic") await runCritic(db, missionId, taskId as string);
    else if (role === "assembler") await runAssembler(db, missionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("role failed", role, missionId, taskId, message);
    try {
      if ((role === "worker" || role === "critic") && taskId) {
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
  }
}

// --- the tick (one mission) -----------------------------------------------
//
// Drive one mission forward in a bounded loop within this single invocation,
// running each ready role inline and awaiting it. Returns when the mission
// pauses at a gate, completes, fails, or the pass cap is hit. The browser kick,
// the post-intervention kick, and the cron sweep re-invoke to continue. Every
// transition is a guarded atomic UPDATE, so re-invocation is idempotent.
async function runTick(
  db: ReturnType<typeof admin>,
  missionId: string,
): Promise<void> {
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
      .select("*")
      .eq("mission_id", missionId)
      .order("order_index", { ascending: true });
    return (data ?? []) as TaskRow[];
  };

  const MAX_PASSES = Number(Deno.env.get("ORCH_MAX_PASSES") ?? "24");

  // Drain any pending interventions once up front.
  {
    const mission = await loadMission();
    if (!mission) return;
    const tasks = await loadTasks();
    await consumeInterventions(db, missionId, mission, tasks);
  }

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const mission = await loadMission();
    if (!mission) return;
    if (mission.status === "complete" || mission.status === "failed") return;
    if (mission.status === "paused" || mission.status === "awaiting_input") return;

    const tasks = await loadTasks();

    // Budget gate.
    if (mission.budget_cents != null && mission.spent_cents >= mission.budget_cents) {
      const { data: flipped } = await db.database
        .from("missions").update({ status: "paused" })
        .eq("id", missionId).eq("status", mission.status).select();
      if (flipped && flipped.length > 0) {
        await emitEvent(db, missionId, "gate_tripped", { kind: "budget", taskId: null });
      }
      return;
    }
    // Step gate.
    if (mission.max_steps != null && mission.step_count >= mission.max_steps) {
      const { data: flipped } = await db.database
        .from("missions").update({ status: "paused" })
        .eq("id", missionId).eq("status", mission.status).select();
      if (flipped && flipped.length > 0) {
        await emitEvent(db, missionId, "gate_tripped", { kind: "steps", taskId: null });
      }
      return;
    }
    // Failed task -> fail mission.
    if (tasks.some((t) => t.status === "failed")) {
      const { data: flipped } = await db.database
        .from("missions").update({ status: "failed" })
        .eq("id", missionId).eq("status", mission.status).select();
      if (flipped && flipped.length > 0) {
        const failed = tasks.find((t) => t.status === "failed");
        await emitEvent(db, missionId, "mission_failed", { reason: `Task ${failed?.id ?? "?"} failed` });
      }
      return;
    }

    // Bootstrap: no tasks yet. Emit started + roster once, run the planner inline.
    if (tasks.length === 0) {
      const { count } = await db.database
        .from("events").select("id", { count: "exact", head: true }).eq("mission_id", missionId);
      if ((count ?? 0) === 0) {
        const { data: goalRows } = await db.database
          .from("missions").select("goal").eq("id", missionId).limit(1);
        const goal = (goalRows?.[0]?.goal as string | undefined) ?? "";
        await emitEvent(db, missionId, "mission_started", { goal });
        for (const member of ROSTER) {
          await emitEvent(db, missionId, "agent_spawned", { agent: member.name, role: member.role });
        }
      }
      if (mission.status === "planning") {
        await runRole(db, missionId, "planner", null);
        continue;
      }
      return;
    }

    // Claim ready pending tasks; risk gate; run workers in parallel.
    const accepted = new Set(tasks.filter((t) => t.status === "accepted").map((t) => t.id));
    const killed = new Set(tasks.filter((t) => t.status === "killed").map((t) => t.id));
    const busy = new Set(
      tasks.filter((t) => t.status === "running" && t.assignee).map((t) => t.assignee as string),
    );
    let rr = 0;
    const nextWorker = (): string => {
      for (const name of WORKER_NAMES) {
        if (!busy.has(name)) { busy.add(name); return name; }
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
          .from("missions").update({ status: "awaiting_input" })
          .eq("id", missionId).eq("status", "running").select();
        if (held && held.length > 0) {
          await emitEvent(db, missionId, "gate_tripped", { kind: "risk", taskId: task.id });
        }
        gated = true;
        break;
      }
      const worker = nextWorker();
      const { data: claimed } = await db.database
        .from("tasks").update({ status: "running", assignee: worker })
        .eq("mission_id", missionId).eq("id", task.id).eq("status", "pending").select();
      if (!claimed || claimed.length === 0) continue;
      await emitEvent(db, missionId, "task_claimed", { taskId: task.id, agent: worker });
      work.push(runRole(db, missionId, "worker", task.id));
    }
    if (gated) {
      await Promise.all(work);
      return;
    }

    // Critics for review tasks, in parallel.
    for (const task of tasks) {
      if (task.status !== "review") continue;
      work.push(runRole(db, missionId, "critic", task.id));
    }

    // Terminal sweep: assemble or fail when nothing is runnable.
    const runnable = tasks.filter((t) => t.status !== "accepted" && t.status !== "killed");
    const anyAccepted = tasks.some((t) => t.status === "accepted");
    let assemblerRan = false;
    if (tasks.length > 0 && runnable.length === 0 && mission.status === "running") {
      if (anyAccepted) {
        const { data: claimed } = await db.database
          .from("missions").update({ status: "assembling" })
          .eq("id", missionId).eq("status", "running").select();
        if (claimed && claimed.length > 0) {
          work.push(runRole(db, missionId, "assembler", null));
          assemblerRan = true;
        }
      } else {
        const { data: flipped } = await db.database
          .from("missions").update({ status: "failed" })
          .eq("id", missionId).eq("status", "running").select();
        if (flipped && flipped.length > 0) {
          await emitEvent(db, missionId, "mission_failed", {
            reason: "All tasks were killed; nothing to assemble.",
          });
        }
        await Promise.all(work);
        return;
      }
    }

    await Promise.all(work);
    if (work.length === 0 && !assemblerRan) return;
  }
}

// --- handler --------------------------------------------------------------
//
// Public entry, called by the browser (kick + after each intervention) and the
// cron (no body = sweep). No worker token: this is the only function, called
// externally, and it only schedules work derivable from table state.
export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  let missionId: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    missionId = body?.missionId;
  } catch {
    // ignore
  }
  const db = admin();
  if (!missionId) {
    const { data: live } = await db.database
      .from("missions")
      .select("id")
      .in("status", ["planning", "running", "assembling", "paused", "awaiting_input"]);
    const ids = ((live ?? []) as { id: string }[]).map((m) => m.id);
    for (const id of ids) await runTick(db, id);
    return json({ ok: true, swept: ids.length });
  }
  const { data: exists } = await db.database
    .from("missions").select("id").eq("id", missionId).limit(1);
  if (!exists || exists.length === 0) return json({ ok: false, error: "mission not found" }, 404);
  await runTick(db, missionId);
  return json({ ok: true, missionId });
}
