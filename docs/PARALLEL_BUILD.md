# HIVE Control Tower: Parallel Build Orchestration Prompt

## What this prompt does

You are the lead engineer and orchestrator for the HIVE control-tower build. This
prompt does one thing: it tells you exactly how to execute the build as a
coordinated team of parallel sub-agents, instead of one slow linear pass. You will
freeze the shared contracts yourself first, then spawn multiple coding sub-agents
that run at the same time on strictly non-overlapping files, then spawn
verification sub-agents that run at the same time, then integrate and ship.

Use this together with two documents in the repo, which are the source of truth
for what to build:
- `docs/BUILD_PROMPT.md`: the full, final specification (the three subsystems,
  exact contracts, Section 9 with every value, default, and shape).
- `docs/PRD.md`: the product intent.

This prompt is the how. BUILD_PROMPT.md is the what. Never let a sub-agent invent
a value that BUILD_PROMPT Section 9 already specifies.

No em-dashes anywhere in code, comments, copy, or commits. Use commas and periods.

## The orchestration model (read before spawning anything)

1. Contracts before fan-out. Every parallel agent must build against frozen
   interfaces. You (the lead) write all shared-contract files yourself, first,
   serially, in Wave 0. Nothing fans out until Wave 0 is committed and green.
2. One file, one owner. Each sub-agent owns a disjoint set of files and is
   forbidden from touching any other agent's files or the contract files. This is
   what makes true parallelism safe. The ownership table below is law.
3. Spawn concurrently. In each wave, spawn all the agents in that wave in a single
   batch so they run at the same time. Do not spawn them one after another.
4. Verify adversarially, then integrate. After the coding wave, spawn verification
   agents in parallel. You apply their blocker and major findings, then run the
   full gauntlet and the browser QA yourself before committing.
5. The build runs offline first. All Wave 0 to Wave 3 work is validated against
   the local simulation (`/?sim`), so it does not block on the human InsForge
   login. The live backend (Phase 0 in BUILD_PROMPT) is provisioned by the human,
   and the live end-to-end QA happens last.

## File ownership table (law; no agent crosses these lines)

| Owner | Owns and may write | Must NOT touch |
| --- | --- | --- |
| LEAD (you) | `package.json`, `src/lib/types.ts`, `src/state/swarm.ts`, `src/state/simulation.ts`, `src/state/*.test.ts`, `src/lib/mission.ts`, `src/lib/insforge.ts`, `migrations/<new>.sql`, `src/App.tsx`, `index.html`, `docs/*`, `README.md` | the per-agent files below, while those agents are running |
| AGENT-BACKEND | `functions/orchestrator.ts`, `functions/agent-run.ts` | everything in `src/`, `migrations/`, `package.json` |
| AGENT-UI | `src/ui/*` (all overlay components, including `Overlay.tsx`) | `src/lib/`, `src/state/`, `src/scene/`, `functions/`, `migrations/` |
| AGENT-SCENE | `src/scene/*` (all r3f files) | `src/ui/`, `src/lib/`, `src/state/`, `functions/`, `migrations/` |

The reducer (`src/state/swarm.ts`), the protocol (`src/lib/types.ts`), the
steering and auth helpers (`src/lib/mission.ts`), and the migration are all
LEAD-owned contracts. AGENT-UI and AGENT-SCENE import from them but never edit
them. AGENT-BACKEND reads the migration and the event contract but never edits
`src/`.

## Wave 0: LEAD freezes the contracts (serial, you do this alone, first)

Do all of this yourself before spawning any sub-agent. Implement strictly per
BUILD_PROMPT sections 4.1, 4.2, 4.5, 4.6, 4.9, and Section 9.

1. `npm install`, then `npm install react-markdown remark-gfm` (BUILD_PROMPT 9.1).
2. `src/lib/types.ts`: add `MissionStatus` values `paused`, `awaiting_input`; add
   `TaskStatus` value `killed`; append the six new `SwarmEvent` variants; extend
   the `Mission` and `Task` interfaces (BUILD_PROMPT 4.2).
3. `migrations/<14-digit-ts>_control_tower.sql`: the full migration in BUILD_PROMPT
   4.1 (governance columns, widened status checks, the `interventions` table, RLS,
   grants).
4. `src/state/swarm.ts`: handle every new event; add the `gate` object,
   `focusTask` + `setFocusTask`, and the new mission and task runtime fields
   exactly as BUILD_PROMPT 9.5 specifies.
5. `src/lib/mission.ts`: add the seven steering helpers and the auth helpers, with
   both the live SDK path and the offline simulation path (BUILD_PROMPT 4.5, 9.4,
   9.7, 9.8). Have `startMission` accept a budget.
6. `src/state/simulation.ts`: extend the scripted mission to emit `budget_updated`
   as cost climbs, fire one `gate_tripped('risk')` that pauses, then approve and
   resume, then finish (BUILD_PROMPT 4.9).
7. Add unit tests for every new event and the gate math; update
   `simulation.test.ts` for the new terminal state.
8. Run the full gauntlet: `npm run lint && npm run build && npx vitest run`. It
   must be green (the new UI and scene do not exist yet; that is fine, the app
   still builds because nothing imports them yet). Commit: "Wave 0: contracts".

Wave 0 output is the frozen interface every parallel agent builds against.

## Wave 1: three coding agents in parallel (spawn all three at once)

Spawn these three sub-agents in a single batch so they run simultaneously. Give
each the exact brief below verbatim, plus "read `docs/BUILD_PROMPT.md` and
`docs/PRD.md` first; the contract files in `src/lib/types.ts`, `src/state/swarm.ts`,
and `src/lib/mission.ts` are frozen, import from them, do not edit them."

### AGENT-BACKEND brief
You own only `functions/orchestrator.ts` and `functions/agent-run.ts`. Do not
touch anything else. Implement BUILD_PROMPT 4.3, 4.4, 9.2, 9.3 (the risk-tag
rule), and 9.6:
- agent-run: after each AI gateway chat call, compute `cost_cents` from the
  Section 9.2 rate table and formula, set the task cost, increment mission
  `spent_cents` and `step_count`, emit `budget_updated`. Workers and the assembler
  read `mission.guidance` and append it to their prompt. The planner tags exactly
  one task `risk = true`.
- orchestrator: at the top of each tick, consume pending interventions oldest
  first and apply each (the seven types, with the exact payload shapes in 9.4),
  marking them applied and emitting `intervention_applied`; then return if paused,
  awaiting_input, complete, or failed; then enforce the budget gate, the step
  gate, and the risk gate, each setting the right status and emitting
  `gate_tripped`; otherwise run the existing claim-and-dispatch.
Keep it idempotent and race-safe with the existing guarded-UPDATE pattern. Every
emitted event payload must match `src/lib/types.ts` field for field. Run
`deno check functions/orchestrator.ts functions/agent-run.ts` if deno is
installed; otherwise verify the brace, paren, and bracket balance and re-read each
changed transition. Do not run any CLI that needs auth. Report: files changed,
the exact event payloads you emit, and any place you deviated and why.

### AGENT-UI brief
You own only `src/ui/*`, including wiring new components into `Overlay.tsx`. Do
not touch anything else. Import the steering and auth helpers from
`src/lib/mission.ts` and read state from the `useSwarm` store; both are frozen.
Build, per BUILD_PROMPT 4.7, 9.3, 9.4, 9.8, 9.9:
- `ControlBar.tsx` (pause/resume, live cost meter with raise-budget, step counter,
  status pill), `GatePrompt.tsx` (the approve / deny / raise-budget / stop card
  when awaiting_input or budget-paused), `Inspector.tsx` (opens on focusAgent or
  focusTask, renders the record and the output via react-markdown, shows cost and
  the causal event chain), `ArtifactViewer.tsx` (render the final artifact
  markdown with copy and download, replacing the bare chip), `Auth.tsx` (email and
  password sign in / sign up / sign out), `MissionHistory.tsx` (the past-missions
  list with reopen).
- Add a budget selector to `MissionConsole.tsx` with the presets in 9.3.
Reuse the design tokens in `src/index.css`; keep it premium; respect
prefers-reduced-motion. Verify with `npm run build` and by loading
`http://localhost:5173/?sim` (the offline steering path makes every control
functional without a backend). Zero console errors. No em-dashes. Report: files
created and how to see each in `?sim`.

### AGENT-SCENE brief
You own only `src/scene/*`. Do not touch anything else. Read the `useSwarm` store
transiently inside `useFrame`; it is frozen. Implement BUILD_PROMPT 4.8 and the
task-node click in 9.9:
- Paused: slow the orbits and slightly desaturate. Gate: pulse amber on the gated
  task node (read the store `gate` object). Killed: dim a killed task node out.
  Cost: feed the cost-meter fraction into the EnergyCore intensity so the core
  visibly strains as budget is consumed.
- Give task nodes an `onClick` that calls `setFocusTask(taskId)`, mirroring the
  agent orbs' `setFocus`.
Follow `docs/r3f-playbook.md`. Do not regress the 60fps budget: no per-frame
allocation, no setState in useFrame, instanced or pooled objects only. Verify with
`npm run build` and `http://localhost:5173/?sim`. Report: files changed and which
state each reaction reads.

## Wave 2: two verification agents in parallel (spawn both at once)

After Wave 1 agents finish and you have merged their files into the working tree,
spawn these two verifiers simultaneously. They do not edit; they report. You apply
their blocker and major findings yourself.

### VERIFIER-BACKEND brief
Adversarially review `functions/orchestrator.ts`, `functions/agent-run.ts`, and
the new migration against `docs/insforge-cheatsheet.md`, the event contract in
`src/lib/types.ts`, and `src/lib/mission.ts`. Check: idempotency and race-safety
of intervention consumption and the gates; that the mission always reaches a
terminal state (no hang under a 429 or a killed dependency); that every emitted
payload matches types.ts field for field; that the gate order is correct; SQL
validity and that the status-check widening will apply; InsForge API fidelity
(admin client, array-form pgvector, realtime untouched, CORS, Deno.env). Output a
ranked findings list (blocker, major, minor) with file and line and a concrete
fix, and a GO or NO-GO verdict.

### VERIFIER-FRONTEND brief
Review `src/ui/*` and `src/scene/*` for correctness against BUILD_PROMPT 4.7, 4.8,
and Section 9. Check: the offline steering path makes every control work in
`?sim`; the inspector opens on both agent and task focus; the gate prompt offers
the right actions for each gate kind; the cost meter and scene cost-reaction read
the same value; no console errors; no per-frame allocation in the scene; premium
visuals and reduced-motion handling; zero em-dashes. Output a ranked findings list
and a GO or NO-GO verdict.

## Wave 3: LEAD integrates and ships (serial, you do this alone)

1. Apply the verifiers' blocker and major fixes (you edit the relevant files; the
   sub-agents are done).
2. Run the full gauntlet until green: `npm run lint && npm run build && npx vitest run`.
3. Drive headless browser QA over `http://localhost:5173/?sim`: launch a mission,
   watch the cost meter, hit the risk gate, approve and inject and raise budget and
   kill, confirm completion and the artifact viewer, assert zero console and page
   errors. Capture screenshots.
4. Commit each coherent piece with a clear message ending in the
   `Co-Authored-By: Claude <noreply@anthropic.com>` line, on a `control-tower`
   branch. Scan the diff for secret-shaped strings before every push. Push to
   `origin` (https://github.com/s-k-28/hive).
5. Live end-to-end QA happens after the human completes Phase 0 (the InsForge
   login and provisioning in BUILD_PROMPT Section 5). Then run a real mission on
   the deployed project and confirm the definition of done in BUILD_PROMPT Section
   8.

## Concurrency summary

- Wave 0: 1 actor (you), serial. Frozen contracts.
- Wave 1: 3 agents at once (BACKEND, UI, SCENE), disjoint files.
- Wave 2: 2 agents at once (VERIFIER-BACKEND, VERIFIER-FRONTEND), read-only.
- Wave 3: 1 actor (you), serial. Integrate, gauntlet, QA, push.

Total sub-agents spawned: five (three coders, two verifiers). They never share a
file. Everything they build stands on the Wave 0 contracts. This is how you turn a
one-day build into a few hours without merge chaos.

Build it clean, verify it adversarially, and make it the best product it can be.
