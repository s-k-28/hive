# HIVE Control Tower — Master Build Prompt (for a coding agent)

You are an elite full-stack engineer building a hackathon-winning product. Your
job is to evolve an existing codebase named HIVE into "the live control tower for
AI agents." Work to a production standard, not a demo standard. Ship it complete,
flawless, and on time. Read this whole document before doing anything.

No em-dashes anywhere in code, comments, copy, or commits. Use commas and
periods. This is a hard rule.

---

## 0. Mission and stakes

HIVE is an entry to the InsForge Hack (deadline June 14, 2026), judged by the
InsForge team across five tracks (best overall, most useful, most fun, most
technically impressive, most visually pleasing). The product must:

- Solve a real, money-on-the-line problem: AI agents cannot be trusted in
  production because they run away (a documented $47K loop), cause irreversible
  damage (the Replit agent wiped a live database despite a freeze), fail silently
  on long tasks, and give no causal trace of why they acted. 74% of production
  agents get rolled back. EU AI Act human-oversight rules are enforceable August
  2026.
- Showcase InsForge deeply: Postgres as a live state machine, edge functions as
  agents, the AI gateway for reasoning, pgvector for memory, and Realtime (their
  flagship 2.0 primitive) as the nervous system. A project that could run on any
  Postgres host wastes the angle and will not win.
- Be visually stunning: a cinematic react-three-fiber cockpit where every node is
  a Postgres row and every state change is a Realtime event.

The repositioning in one line: HIVE lets you run a team of AI agents you can see,
stop, and steer in real time.

## 1. Ground yourself in the existing codebase first

The repository is public at https://github.com/s-k-28/hive. Clone it. It already
contains a working multi-agent engine and a 3D UI. Do not rebuild it; extend it.

Read these files before writing anything, in this order:

1. `docs/PRD.md` — the full product definition, scope, and build plan. This build
   prompt is the executable version of that PRD. If anything here is ambiguous,
   the PRD is the source of truth for intent.
2. `docs/insforge-cheatsheet.md` — verified InsForge API reference (SDK, auth,
   database, realtime, edge functions, AI gateway, pgvector, storage, sites,
   migrations, RLS, gotchas). Treat it as canonical. Do not invent API shapes.
3. `src/lib/types.ts` — the swarm protocol (SwarmEvent union, Mission, Task,
   AgentName, AGENT_ROSTER, ROLE_COLORS). All new events extend this.
4. `src/state/swarm.ts` — the zustand reducer that turns the event stream into
   scene and UI state. `src/state/simulation.ts` — a scripted local mission used
   for tests and for running the UI without a backend.
5. `functions/orchestrator.ts` and `functions/agent-run.ts` — the Deno edge
   functions. The orchestrator is a race-safe, idempotent tick; agent-run is the
   role-parametrized worker (planner, worker, critic, assembler).
6. `migrations/*.sql` — the current schema (missions, tasks, events, memories),
   RLS, the pgvector match RPC, and the realtime publish trigger.
7. `src/scene/*` — the r3f scene (EnergyCore, AgentOrb, TaskGraph, FlowEdge,
   AgentTaskBeam, Constellation, Effects, CameraRig, layout). `src/ui/*` — the
   glass overlay (Header, MissionConsole, MissionLog, SwarmRoster,
   ProgressArtifact).
8. `docs/r3f-playbook.md` — the 3D recipes, perf budget, and package versions
   already in use. Follow it for any scene work.

What already works and must keep working: the swarm runs a goal through
planner -> workers -> critic (with one reject-and-retry) -> assembler, emitting
events that stream over Realtime to the scene and log; pgvector memory recall;
storage artifacts; 25 passing reducer tests; lint, typecheck, and build all green.

## 2. The goal of this build: three new subsystems

Turn the swarm into a governed, observable, steerable control tower by adding
exactly three subsystems on top of the existing engine. Do not add anything else.

A. Gate engine (the circuit breaker). Per-mission cost budget, step cap, and a
   risk gate for high-impact tasks, enforced in the orchestrator before any
   dispatch. Trip a limit and the swarm pauses and asks the human, instead of
   burning money or doing damage.

B. Steering control plane (live human control). From the cockpit the operator can
   pause/resume, raise the budget, kill a task, approve or deny a gated action,
   and inject a constraint the agents pick up and re-plan around.

C. Causal inspector (the flight recorder). Click any node to see why it ran
   (its dependencies and recalled memories), what it produced (rendered
   markdown), and what it cost. Plus a live cost meter and a final artifact
   viewer.

Also wire real auth (so missions belong to a user) and a "your missions" history.

## 3. Non-negotiable constraints

- TypeScript strict everywhere. Lint (`npm run lint`), typecheck (`tsc -b`), and
  build (`npm run build`) must be green before every commit.
- Tests are a release gate. Extend the vitest suite for every new event and the
  gate math. `npx vitest run` must pass.
- Zero console errors and no dead UI states in the browser.
- Do not break existing behavior. The current swarm run, the scene, and the 25
  tests must still pass.
- Match existing code style: named exports, focused files, comments only where
  they state a real constraint.
- InsForge fidelity: every backend call must match `docs/insforge-cheatsheet.md`.
  Deno edge functions use `npm:@insforge/sdk` and `npm:openai`, handler signature
  `export default async function(req: Request): Promise<Response>`, CORS OPTIONS,
  secrets via `Deno.env.get`.
- No em-dashes. The 3D and glass aesthetic must stay premium; no generic AI look.

## 4. Architecture and exact contracts (implement these precisely)

### 4.1 Database migration (new file `migrations/<14-digit-ts>_control_tower.sql`)

Follow the existing migration rules: 14-digit UTC timestamp prefix, no
BEGIN/COMMIT, idempotent where possible.

```sql
-- missions: governance fields and two new statuses
alter table missions add column if not exists budget_cents int;
alter table missions add column if not exists spent_cents int not null default 0;
alter table missions add column if not exists step_count int not null default 0;
alter table missions add column if not exists max_steps int;
alter table missions add column if not exists guidance text;  -- injected constraints, appended
-- widen the status check to include 'paused' and 'awaiting_input'
alter table missions drop constraint if exists missions_status_check;
alter table missions add constraint missions_status_check
  check (status in ('planning','running','assembling','complete','failed','paused','awaiting_input'));

-- tasks: cost, risk gate, risk approval, and a 'killed' status
alter table tasks add column if not exists cost_cents int not null default 0;
alter table tasks add column if not exists risk boolean not null default false;
alter table tasks add column if not exists risk_approved boolean not null default false;
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check
  check (status in ('pending','running','review','rejected','accepted','failed','killed'));

-- interventions: the steering control plane
create table if not exists interventions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  type text not null check (type in
    ('pause','resume','raise_budget','kill_task','approve_gate','deny_gate','inject')),
  payload jsonb not null default '{}',
  applied boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists interventions_pending
  on interventions(mission_id) where applied = false;

-- RLS: owner (and anon for the demo) may INSERT and SELECT interventions for
-- their mission; edge functions use the admin client and bypass RLS for the
-- applied-flag update. Mirror the posture in the existing rls_grants migration.
alter table interventions enable row level security;
create policy interventions_insert_any on interventions
  for insert to anon, authenticated with check (true);
create policy interventions_select_any on interventions
  for select to anon, authenticated using (true);
grant select, insert on interventions to anon, authenticated;
```

Acceptance: the migration applies cleanly with `npx @insforge/cli db migrations
up --all` and the new columns and table exist.

### 4.2 Event protocol (extend `src/lib/types.ts`)

Add to `MissionStatus`: `'paused' | 'awaiting_input'`. Add to `TaskStatus`:
`'killed'`. Append to the `SwarmEvent` union, and mirror the field names exactly
(camelCase) in the edge-function payloads:

```ts
| { type: 'budget_updated'; spentCents: number; budgetCents: number | null; stepCount: number; maxSteps: number | null }
| { type: 'gate_tripped'; kind: 'budget' | 'steps' | 'risk'; taskId: string | null }
| { type: 'intervention_applied'; kind: string; taskId: string | null; note: string | null }
| { type: 'mission_paused' }
| { type: 'mission_resumed' }
| { type: 'task_killed'; taskId: string }
```

Extend the Mission and Task interfaces with the new fields (budgetCents,
spentCents, stepCount, maxSteps, guidance; task cost_cents -> costCents, risk,
riskApproved). Keep snake_case in DB columns and camelCase in event payloads, as
the existing code does.

### 4.3 Cost accounting (in `functions/agent-run.ts`)

After each AI gateway chat call, read `completion.usage` (prompt_tokens,
completion_tokens) and the model id, and compute `cost_cents` from a small
per-model rate table (approximate published rates; a constant map is fine).
Atomically: set the task `cost_cents`, increment mission `spent_cents` and
`step_count`, then emit `budget_updated` with the new totals. Keep this best
effort and never let an accounting error fail the task. Each agent-run counts as
at least one step.

### 4.4 Gate enforcement and intervention handling (in `functions/orchestrator.ts`)

The orchestrator already loads the mission and tasks each tick. Add, in this
order, at the top of the tick after loading:

1. Consume pending interventions for this mission (`applied = false`), oldest
   first, mark each `applied = true`, and apply:
   - `pause`: status -> 'paused', emit `mission_paused`.
   - `resume`: status -> 'running' (or 'planning' if no tasks), emit
     `mission_resumed`.
   - `raise_budget`: `budget_cents = payload.budgetCents`; if currently paused on
     budget, resume; emit `budget_updated`.
   - `kill_task`: task.status -> 'killed', emit `task_killed`.
   - `approve_gate`: task.risk_approved = true, status -> 'running' if it was
     gated, clear `awaiting_input`, emit `intervention_applied('approve', taskId)`.
   - `deny_gate`: task.status -> 'killed', clear `awaiting_input`, emit
     `task_killed`.
   - `inject`: append `payload.note` to mission.guidance, emit
     `intervention_applied('inject', null, note)`.
   Emit `intervention_applied` for each applied intervention (kind set
   appropriately).
2. If status in ('paused','awaiting_input','complete','failed'): return without
   dispatching (idempotent: a tick during a pause does nothing).
3. Budget gate: if `budget_cents` is not null and `spent_cents >= budget_cents`:
   status -> 'paused', emit `gate_tripped('budget')`, return.
4. Step gate: if `max_steps` is not null and `step_count >= max_steps`:
   status -> 'paused', emit `gate_tripped('steps')`, return.
5. Risk gate: when about to dispatch a worker for a `risk = true` task that is not
   `risk_approved`: set status -> 'awaiting_input', emit
   `gate_tripped('risk', taskId)`, return (do not dispatch it).
6. Otherwise proceed with the existing claim-and-dispatch logic.

Killed tasks are terminal and excluded from the dependency-ready check. When no
runnable tasks remain and at least one task is accepted, proceed to the assembler
with the accepted tasks (the assembler already composes from accepted only).

The planner must tag exactly one high-impact task (the synthesis or a clearly
consequential step) `risk = true` so the risk gate fires in a real run. Add this
to the planner prompt and to the task insert.

Keep everything idempotent and race-safe with the existing guarded-UPDATE
pattern. The browser triggers immediate application by inserting an intervention
then invoking the orchestrator once.

### 4.5 Frontend control plane (in `src/lib/mission.ts`)

Add helpers that insert an intervention row via the SDK and then invoke the
orchestrator once to apply it immediately: `pauseMission`, `resumeMission`,
`raiseBudget(cents)`, `killTask(taskId)`, `approveGate(taskId)`,
`denyGate(taskId)`, `injectNote(note)`. In dev mode (no client) route these to
the simulation so the UI works offline. Also add InsForge auth helpers (sign up,
sign in, sign out, get current user) and have `startMission` accept a budget and
set `user_id` when signed in.

### 4.6 Reducer (in `src/state/swarm.ts`)

Handle every new event: update mission spentCents/budgetCents/stepCount on
`budget_updated`; set status and a `gate` object on `gate_tripped`; set
paused/resumed status; mark a task killed on `task_killed`; append to a log line
on `intervention_applied`. Keep the transient-friendly shape for the scene.
Extend the SceneFx if a gate needs a one-shot visual. Add unit tests for each.

### 4.7 New UI components (in `src/ui/`)

- `ControlBar.tsx`: pause/resume button, a live cost meter (spent vs budget) with
  a raise-budget control, the step counter, and the mission status pill.
- `GatePrompt.tsx`: when status is 'awaiting_input' or budget-paused, a clear card
  explaining the gate (risk task, budget hit, or step cap) with the right
  actions: Approve, Deny, Raise budget, or Stop.
- `Inspector.tsx`: opens when a node is selected (reuse the existing focusAgent or
  add a focusTask in the store). Shows the task or agent record: title, status,
  dependencies, recalled memory summaries, the output rendered with
  `react-markdown` + `remark-gfm`, the cost, and the ordered events that touched
  it (the causal chain).
- `ArtifactViewer.tsx`: render the final artifact markdown in-app with copy and
  download, replacing the bare chip in `ProgressArtifact`.
- `Auth.tsx`: sign in / sign up / sign out wired through `src/lib/mission.ts`
  auth helpers, surfaced from the header.
- `MissionHistory.tsx`: a list of the user's past missions (query `missions`),
  with reopen that re-subscribes and replays persisted events.

Reuse the design tokens in `src/index.css` and the glass helpers. Keep it premium.

### 4.8 Scene reactions (small changes in `src/scene/*`)

- Paused: slow the orbits and slightly desaturate (read mission.status transiently
  in useFrame).
- Gate: pulse amber on the gated task node (read the store's gate object).
- Killed: dim a killed task node out.
- Cost: feed the cost-meter fraction into the EnergyCore intensity so the core
  visibly strains as budget is consumed.
Follow `docs/r3f-playbook.md`. Do not regress the 60fps budget. No per-frame
allocation, no setState in useFrame.

### 4.9 Simulation (in `src/state/simulation.ts`)

Extend the scripted mission so it exercises the new path for tests and offline
demo: emit `budget_updated` events as cost climbs, fire one `gate_tripped('risk')`
that pauses, then an `intervention_applied('approve')` and `mission_resumed`, then
finish. Update `simulation.test.ts` for the new terminal state.

## 5. Implementation order (dependency-correct, commit after each phase green)

Phase 0 (human-gated, do first): provision InsForge. The human runs
`npx @insforge/cli login`, links a project, runs `npx @insforge/cli ai setup`,
and provides the project URL and keys. Then apply existing migrations, create the
`artifacts` storage bucket, set secrets (OPENROUTER_API_KEY, INSFORGE_URL,
INSFORGE_API_KEY, WORKER_TOKEN, FUNCTIONS_BASE_URL), deploy `orchestrator` and
`agent-run`, register the cron sweep, set VITE_INSFORGE_URL and
VITE_INSFORGE_ANON_KEY, and deploy the site. Follow `docs/deploy.md`. Prove the
existing swarm runs once live before adding anything. Resolve the deploy.md
UNVERIFIED items here (npm: vs esm.sh imports, realtime wire shape, pgvector
array vs bracketed-string, dispatch survival).

Phase 1: contracts. Add the migration (4.1) and extend `src/lib/types.ts` (4.2).
Apply the migration live. Commit.

Phase 2: backend gates + accounting. Implement 4.3 and 4.4 in agent-run and
orchestrator. Have a verification agent adversarially review the orchestrator
state machine for idempotency, race-safety, and termination. Commit.

Phase 3: reducer + control-plane lib + simulation. Implement 4.5, 4.6, 4.9 with
unit tests. `npx vitest run` green. Commit.

Phase 4: UI. Build 4.7 (ControlBar, GatePrompt, Inspector, ArtifactViewer) and
4.8 scene reactions. Verify in the browser with the simulation. Commit.

Phase 5: auth + history. Implement the auth helpers and `Auth.tsx`,
`MissionHistory.tsx`, scope missions to the user. Commit.

Phase 6: live end-to-end QA and hardening. Run a real mission on the deployed
project: watch the cost meter, trip the risk gate, steer (approve, inject, raise
budget, kill), confirm a clean completion and a downloadable artifact, zero
console errors. Fix anything. Final deploy. Commit.

If time compresses, cut in this order: history (Phase 5) first, then inspector
depth, then one steering action. Never cut the gate-trips-and-you-steer moment,
which is the heart of the product.

## 6. How to execute: multi-agent with verification

Do not build this with a single linear pass. Use specialist coding agents and
independent verification agents, exactly as a strong team would:

- Spawn a backend coding agent for the migration, orchestrator, and agent-run
  changes; a frontend coding agent for the UI components; and a scene coding
  agent for the r3f reactions. Give each a strict file boundary so they do not
  collide (backend owns `functions/` and `migrations/`; frontend owns `src/ui/`
  and `src/lib/`; scene owns `src/scene/`; the reducer in `src/state/` is a
  shared contract changed once, up front, by you).
- After each backend deliverable, spawn an adversarial verification agent that
  reviews for correctness against `docs/insforge-cheatsheet.md`, the event
  contract, idempotency, race-safety, and termination. Apply its blocker and
  major findings before merging.
- After each frontend deliverable, run the headless browser QA (Playwright is
  available; load the dev server at `/?sim`, drive the flow, screenshot, and
  assert zero console errors).
- Nothing merges unless lint, typecheck, build, and tests are green. Run the full
  gauntlet before every commit: `npm run lint && npm run build && npx vitest run`.

## 7. Git and delivery

- Work in the cloned `s-k-28/hive` repo. Create a branch `control-tower`.
- Commit after each green phase with a clear message. End every commit message
  with this line on its own:
  `Co-Authored-By: Claude <noreply@anthropic.com>`
- Push to origin: `git push -u origin control-tower`. Open a pull request to
  `main` titled "HIVE control tower: governance, observability, steering", with a
  body summarizing the three subsystems and the live demo result. If you are
  operating solo and trunk-based is preferred, you may instead push directly to
  `main` after the full gauntlet is green.
- The repository must remain public. Do not commit any secret value. Secrets live
  only in InsForge function secrets and the local untracked `.env`; the repo
  references them by name only. Scan the diff for leaked keys before every push.
- Keep `docs/PRD.md`, `docs/deploy.md`, and the README in sync if behavior
  changes. Update the README's tagline and "Why this matters" to the control
  tower positioning.

## 8. Definition of done

- A signed-in user on the hosted InsForge URL launches a real mission, watches it
  in the cockpit with a live cost meter, sees a gate trip, steers the swarm live,
  and gets a real, readable, downloadable artifact, with zero console errors.
- The new gate math and every new reducer event are unit tested; lint, typecheck,
  build, and the full test suite are green.
- The whole experience feels like a finished product: no dead states, no rough
  edges, premium visuals, instant and legible feedback for every action.
- All work is committed and pushed to https://github.com/s-k-28/hive, repo
  public, no secrets leaked.

Build it clean, verify it adversarially, and make it the best product it can be.
