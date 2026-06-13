# HIVE — Product Requirements Document

**Repositioning:** HIVE is the live control tower for AI agents. Run a team of
agents you can see, stop, and steer in real time, on InsForge.

**Tagline:** Run AI agents you can actually put in production, because you can
see them, stop them, and steer them, live.

Date: 2026-06-12. Hackathon deadline: 2026-06-14. Status: planning complete,
pending approval to build.

---

## 1. The problem (with evidence)

AI agents are being adopted fast for real work, but they cannot be trusted while
they run. The pain is not capability, it is governance and observability. From
the research pass (Reddit, Hacker News, Indie Hackers, vendor incident reports,
2025-2026), every signal points the same way:

- **They run away.** A documented $47,000 agent loop ran for 11 days; every call
  returned 200, nothing watched the run-level. A $1,400 Cursor bill in one hour.
- **They cause irreversible damage.** The Replit agent wiped a live database
  despite an explicit freeze. An AutoGen agent destroyed a $106K AWS account.
  74% of production agents get rolled back (survey of 2,527 decision-makers).
- **They fail silently.** Plausible-but-wrong output on long tasks ("agent
  half-life" is peer-reviewed); hallucinations become "load-bearing" in
  multi-agent chains; drift goes unnoticed for weeks.
- **You cannot see why.** Flat logs record what happened, never what in the
  prior context caused it. Whole startups exist for this gap (LangSmith,
  Langfuse, Arize) yet none enforce anything before the action fires.
- **Regulation is arriving.** EU AI Act Article 14 (human oversight) is
  enforceable August 2026.

**The unmet wedge:** no product combines (1) deterministic pre-call gates that
physically stop an agent before it exceeds scope or budget, (2) a causal trace
of why each step happened, (3) persistent state across sessions, and (4)
structured human override. Frameworks own planning and execution; observability
tools own the post-hoc trace; nobody governs the run, live.

## 2. The product

HIVE runs a team of AI agents and wraps them in a control tower:

- **See it.** The Postgres task and event DAG rendered as the 3D cockpit, with a
  live cost meter and step counter. Click any node to see why it ran, what it
  recalled, what it produced, and what it cost. That is the causal trace.
- **Stop it.** The orchestrator enforces hard limits before each dispatch: a cost
  budget, a step cap, and a risk gate for high-impact tasks. Trip a limit and
  the swarm pauses and asks the human instead of burning money or doing damage.
- **Steer it.** From the cockpit the operator pauses or resumes, raises the
  budget, kills a dead-end branch, approves or denies a gated action, or injects
  a constraint the agents pick up and re-plan around.
- **Trust it.** The critic self-verifies to catch silent failure; pgvector
  persists context so it is not Groundhog Day across sessions.

This reuses roughly 80% of what is already built (the swarm engine, task DAG,
event stream, realtime, 3D scene, critic, memory). The new work is three focused
subsystems: the gate engine, the steering control plane, and the causal
inspector.

## 3. Product-market fit analysis

**Target user (primary):** developers and small teams running AI agents on real
work today: Cursor / Claude Code / CrewAI / LangGraph / n8n users, AI product
builders, automation engineers. They have personally been burned by a runaway
bill, a wrong-but-confident output, or an agent that went off the rails.

**Job to be done:** "Let me run agents on real work without a surprise bill, a
wiped database, or silent wrong output. Let me see, stop, and steer them."

**Why now:** agent adoption is exploding while 74% get rolled back; the dollar
incidents are public and large; EU AI Act oversight lands August 2026. The
market is actively shopping for control, not more autonomy.

**Willingness to pay:** teams already pay for LLM observability (LangSmith,
Arize, Langfuse) and are actively losing money to runaway cost. Governance is a
budget line, not a nice-to-have. The buyer is the same eng leader who approves
the OpenAI bill.

**Competitive wedge:** observability tools trace after the fact but enforce
nothing; agent frameworks execute but do not govern; "human-in-the-loop" today
means capping agents under 10 steps (a retreat, not a solution). Partial players
to avoid copying: Waxell (policy, no causal graph), Omium (recovery, no pre-call
gate), Portia (steerable plans, limited maturity). None combine all four
properties. That gap is the product.

**Honest PMF risk and the answer.** The MVP governs HIVE's own swarm, not an
arbitrary external agent. That is the right scope for a 2-day build and a demo,
and it proves the capability end to end. The real-product path is to expose the
same control plane as an SDK and an MCP interface so any agent (a user's Claude
Code, a CrewAI crew) runs "inside" HIVE and inherits the gates, trace, and
steering. The MVP is the proof; the "govern any agent" interface is the
roadmap, and we state that openly rather than pretend the MVP is the whole
company.

## 4. Scope for the timeframe (what is in, what is out)

**In (the MVP that ships by June 14):**
- The existing swarm performing a real knowledge task via the AI gateway (no
  external tools required), end to end on live InsForge.
- Cost + step accounting per mission, surfaced as a live meter.
- Gate engine: budget cap, step cap, risk-tagged task approval. Pause on trip.
- Steering control plane: pause/resume, raise budget, kill task, approve/deny
  gate, inject a constraint. Applied within one tick.
- Causal inspector: click a node, see its inputs, recalled memories, output
  (rendered markdown), cost, and the event chain that produced it.
- Auth (sign in), so missions and their history belong to a user.
- Artifact viewer for the final deliverable (read, copy, download).
- Deployed and hosted on InsForge with a public URL.
- Tests for the new reducer logic and the gate math.

**Out (explicitly deferred, stated so we do not drift):**
- Governing arbitrary external agents (the SDK/MCP "any agent" interface).
- Real destructive-tool execution (the risk gate is demonstrated on a tagged
  task; we do not wire real infra actions).
- Web-search or other external tools for the agents (core uses the AI gateway
  only; optional stretch).
- Compliance-grade WORM audit export, team multiplayer, mobile.

## 5. Key user flows

1. **Run.** Sign in, type a goal, set a budget (default provided), launch. The
   swarm forms; the cost meter and step counter start; events stream to the 3D
   cockpit and the log.
2. **Observe.** Click an agent or task node; the inspector shows why it ran, what
   it recalled, what it produced, and what it cost.
3. **Govern (automatic).** A task is risk-tagged or the budget is approached; the
   orchestrator pauses the swarm and the cockpit surfaces the gate.
4. **Steer (manual).** The operator approves or denies, raises the budget, kills
   a branch, or injects a constraint; the swarm resumes and adapts.
5. **Finish.** The mission completes under budget; the operator reads, copies, or
   downloads the artifact, and can reopen it later from history.

## 6. Architecture

**Reused as-is:** Vite + React 19 + r3f frontend, the zustand event reducer, the
3D scene, the orchestrator and agent-run edge functions, the realtime publish
trigger, pgvector memory, storage artifacts, the swarm protocol and tests.

**New backend (migrations + function changes):**
- `missions`: add `budget_cents int`, `spent_cents int default 0`,
  `step_count int default 0`, `max_steps int`, and extend `status` with
  `paused` and `awaiting_input`.
- `tasks`: add `cost_cents int default 0`, `risk boolean default false`.
- New table `interventions`: `id`, `mission_id`, `type`
  (pause|resume|raise_budget|kill_task|approve_gate|deny_gate|inject), `payload
  jsonb`, `applied boolean default false`, `created_at`. RLS lets the owning user
  insert; the orchestrator (admin) reads and marks applied.
- `agent-run`: read token usage from the AI gateway response, write
  `cost_cents` to the task and increment mission `spent_cents` / `step_count`.
- `orchestrator` (the control loop), each tick, in order: apply pending
  interventions; if `paused` or `awaiting_input`, stop; before any dispatch
  check `spent_cents >= budget_cents` or `step_count >= max_steps` (trip the
  budget/step gate, set `paused`, emit `gate_tripped`); before a `risk` task set
  `awaiting_input` and emit `gate_tripped(risk)`; otherwise dispatch as today.
- The planner tags one synthesis or high-impact task `risk = true` so the
  approval gate is exercised in a real run.

**The control plane (how steering stays live without long-lived functions):** the
browser writes an `interventions` row via the SDK, then invokes the orchestrator
once to apply it immediately. The orchestrator consumes interventions on its
tick (idempotent: `applied` guard). Gate prompts use the existing event channel
so the UI reacts instantly. No edge function needs to hold a subscription.

**New event types (extend the SwarmEvent union, reducer, and tests):**
`budget_updated{spentCents,budgetCents,stepCount,maxSteps}`,
`gate_tripped{kind:'budget'|'steps'|'risk', taskId?}`,
`intervention_applied{kind, taskId?, note?}`, `mission_paused`,
`mission_resumed`, `task_killed{taskId}`.

**New frontend:**
- Control bar: pause/resume, budget meter + raise control, mission status.
- Gate prompt: when `awaiting_input` or budget-paused, a clear approve / deny /
  raise-budget / stop card.
- Causal inspector: click a node, render its record (inputs, recalled memory
  ids, output markdown via react-markdown, cost, event chain).
- Scene reactions: paused (orbits slow, desaturate), gate (pulsing amber on the
  gated node), killed (node dims out), cost meter feeding the core intensity.

## 7. Connectors, plugins, MCP, tooling (status)

| Need | Status | Action |
| --- | --- | --- |
| InsForge SDK (`@insforge/sdk@1.4.0`) | Installed | none |
| three / r3f / drei / postprocessing / zustand | Installed | none |
| vitest | Installed | none |
| Playwright (browser QA) | Cached (6 chromium builds) | none |
| `react-markdown` + `remark-gfm` (inspector + artifact) | Not installed | add at build start |
| InsForge CLI (`@insforge/cli@0.1.89`) | Reachable via npx | `npx @insforge/cli login` (you) |
| InsForge project (DB, edge fns, AI gateway, realtime, auth, storage, hosting) | Not provisioned | login + `link` (you), then I provision |
| AI gateway key (OpenRouter via InsForge) | Not set | `npx @insforge/cli ai setup` (you) |
| InsForge remote MCP (operate backend by agent; strengthens story) | Connectable post-login | `claude mcp add` HTTP + OAuth, optional |
| Web search API for agent tools | Not needed for MVP | optional stretch only |

**The only true blockers that need you:** the InsForge login, the project link,
and the AI gateway key. Everything else is in hand or installable by me. The
remote MCP is optional (the architecture uses the SDK, edge functions, and
realtime; MCP would let me drive the backend agent-natively during build and
backs the "agent-native" narrative, but it is not on the critical path).

## 8. Build plan and timeline (to June 14)

Sequenced so the demoable surface exists early and each piece is verifiable.
Frontend work runs in parallel with backend via specialist agents plus verifier
agents, as before.

- **Phase 0 — Provision (you + me, ~30 min).** Login, link, AI key, apply current
  migrations, create the artifacts bucket, set secrets, deploy the two functions,
  set site env, first deploy. Prove the *existing* swarm runs once live (closes
  the Phase 1 of the production plan). This is the gate for everything.
- **Phase 1 — Accounting + gates (backend, ~half day).** Add the migration for
  budget/steps/risk/interventions; make agent-run record cost; make the
  orchestrator enforce budget/step/risk gates and pause. New event types emitted.
  Verifier agent reviews; unit-test the gate math.
- **Phase 2 — Steering control plane (backend + frontend, ~half day).** The
  interventions table + orchestrator consumption; the browser control bar and
  gate prompt; pause/resume, raise budget, kill task, approve/deny, inject. Wire
  through the reducer (with tests).
- **Phase 3 — Causal inspector + cost meter + artifact viewer (frontend, ~half
  day).** Click-to-inspect panel (react-markdown), the live cost meter feeding
  the scene, the artifact viewer. Scene reactions for paused/gated/killed.
- **Phase 4 — Auth + history (frontend + backend, ~quarter day).** Wire InsForge
  auth into the overlay; scope missions to the user; a "your missions" list with
  reopen (replay persisted events).
- **Phase 5 — Live QA + hardening (~quarter day).** Full end-to-end on the live
  project: run a real mission, trip each gate, steer each way, confirm zero
  console errors, lint + typecheck + build + tests green, deploy the final site.
- **Phase 6 — Demo video (~quarter day).** Script and record the sub-3-minute
  narrated screencast (section 9).

Each phase ends green (lint, typecheck, build, tests) and is committed. If time
compresses, cut order is: history (Phase 4) first, then the inspector depth, then
one steering action; never cut the gate-trip-and-steer moment, which is the
whole pitch.

## 9. Demo and video plan (sub-3-minute, narrated screencast)

- 0:00-0:20: name and the problem. "AI agents are powerful and impossible to
  trust in production. They run away, burn thousands, and you find out too late."
- 0:20-1:00: launch a real mission in the 3D cockpit; the swarm forms; the cost
  meter climbs; click a node to show the live causal trace.
- 1:00-1:50: a task hits the risk gate (or the budget). The swarm pauses and asks.
  This is the money shot: "It stopped itself before doing the risky thing."
- 1:50-2:30: steer live: inject a constraint, raise the budget, approve the gate;
  the swarm adapts and finishes under budget; open the artifact.
- 2:30-3:00: cut to the InsForge dashboard (tables, the events stream, realtime
  channel, functions) and close: "the agents, their state, their governance, and
  this whole control tower run on InsForge." Show the hosted URL.

Narrate the InsForge integration explicitly at least twice (realtime channel on
screen, Postgres rows changing). Build the video as an asset InsForge would
proudly reshare.

## 10. How it wins each track

- **Most technically impressive:** a race-safe governed control loop, real cost
  accounting, deterministic gates, a causal trace built on the Postgres DAG, all
  on InsForge realtime, with tests.
- **Most visually pleasing:** the cinematic 3D cockpit, now functional (every
  node a Postgres row, every state change a realtime event), not decorative.
- **Most useful:** it solves a real, money-on-the-line pain that everyone running
  agents has felt.
- **Best overall:** the only entry that is useful, technically deep, and
  beautiful at once, and that makes InsForge look like the platform you must
  build agents on.
- **Most fun or interesting:** "flying" a swarm of agents and yanking one back
  from the brink is genuinely fun to watch and do.

## 11. Risks and mitigations

- **Live-backend unknowns (npm: imports, realtime wire shape, pgvector array
  form, dispatch survival).** Mitigation: Phase 0 proves the existing swarm live
  before we add anything; the deploy runbook already lists each fallback.
- **Scope creep.** Mitigation: the cut order in section 8; the gate-and-steer
  moment is protected; everything else is negotiable.
- **AI cost/latency during the demo.** Mitigation: cheap models for workers, a
  tight default budget, pre-warmed run for the recording.
- **Time.** Mitigation: ~80% reuse; parallel specialist + verifier agents; each
  phase independently shippable.

## 12. Definition of done

- A signed-in user on the hosted InsForge URL launches a real mission, watches it
  in the cockpit with a live cost meter, sees a gate trip, steers the swarm live,
  and gets a real, readable, downloadable artifact, with zero console errors.
- Lint, typecheck, build, and tests are green; the new gate and reducer logic is
  tested.
- The sub-3-minute video shows the run, the gate, the steer, and the InsForge
  plumbing.
- Public repo, committed and pushed.
