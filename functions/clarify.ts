/* eslint-disable @typescript-eslint/no-explicit-any --
   Deno edge function, type-checked on the InsForge runtime at deploy, not by the
   browser app's TypeScript/ESLint. The any is the OpenAI params passthrough. */

// HIVE clarify: generate a few sharp, goal-aware clarifying questions before a
// mission launches, so the swarm builds exactly what the operator wants. Pure
// request/response (no DB writes): the browser POSTs { goal, repo? } and gets
// back { questions: [...] }. The browser collects answers and folds them into
// the mission's guidance at launch (see src/lib/clarify.ts). External AI gateway
// call only, so it is not subject to the function-to-function 508 rule.

import OpenAI from "npm:openai";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function openai(): OpenAI {
  return new OpenAI({
    baseURL: Deno.env.get("AI_BASE_URL") || "https://openrouter.ai/api/v1",
    apiKey: Deno.env.get("OPENROUTER_API_KEY"),
    defaultHeaders: { "HTTP-Referer": "https://hive.insforge.app", "X-Title": "Hive" },
  });
}

function extractJson<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error("no parseable JSON");
  }
}

interface RawQuestion {
  id?: string;
  question?: string;
  kind?: string;
  options?: unknown;
  placeholder?: string;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  let goal = "";
  let repo: { fullName?: string; ref?: string } | null = null;
  try {
    const body = await req.json();
    goal = String(body?.goal ?? "").slice(0, 2000).trim();
    repo = body?.repo ?? null;
  } catch {
    // fall through; empty goal handled below
  }
  if (!goal) return json({ questions: [] });

  const repoNote = repo?.fullName
    ? ` The mission is scoped to the GitHub repository ${repo.fullName} (branch ${repo.ref ?? "default"}); ask at least one question that pins down which part of the repo to focus on and what kind of change is wanted.`
    : "";

  const system =
    "You are the intake specialist for an autonomous agent swarm. Given the " +
    "operator's goal, produce 3 to 5 SHORT, high-leverage clarifying questions " +
    "whose answers would most reduce ambiguity and prevent the swarm from " +
    "building the wrong thing." +
    repoNote +
    " Prefer concrete, answerable questions over open-ended ones. Where a small " +
    "set of likely answers exists, make it a choice question with 2-4 options. " +
    'Return STRICT JSON only: an array of {"id": short-slug, "question": string, ' +
    '"kind": "choice" | "text", "options"?: [string], "placeholder"?: string}. ' +
    "No prose, no markdown, JSON array only.";

  try {
    const ai = openai();
    const completion = await ai.chat.completions.create({
      model: Deno.env.get("AI_PLANNER_MODEL") || "openai/gpt-4o",
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Goal: ${goal}` },
      ],
      temperature: 0.4,
    } as any);
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson<RawQuestion[]>(raw);
    if (!Array.isArray(parsed)) return json({ questions: [] });
    const questions = parsed.slice(0, 6).map((q, i) => ({
      id: typeof q.id === "string" && q.id ? q.id : `q${i + 1}`,
      question: String(q.question ?? "").slice(0, 240),
      kind: q.kind === "choice" ? "choice" : "text",
      options: Array.isArray(q.options) ? q.options.slice(0, 5).map((o) => String(o)) : undefined,
      placeholder: q.placeholder ? String(q.placeholder).slice(0, 80) : undefined,
    })).filter((q) => q.question.length > 0);
    return json({ questions });
  } catch (e) {
    console.error("clarify failed", e);
    // Let the browser fall back to its heuristic questions.
    return json({ questions: [] });
  }
}
