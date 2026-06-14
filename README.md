<div align="center">

# HIVE

### The live control tower for AI agents.

**Run a team of AI agents you can see, stop, and steer.** Hand the swarm a goal, then watch a transparent team of agents plan, execute in parallel, review their own work, and ship a finished artifact, with a live cost meter, hard risk gates that stop and ask, and one-click intervention the whole way. It runs entirely on [InsForge](https://insforge.dev).

**[▶ Launch the live deck](https://nmf6vbv4.insforge.site)**  ·  Built for the InsForge Hack, June 2026

<img src="docs/media/landing.png" width="820" alt="HIVE landing: run a team of AI agents you can see, stop, and steer" />

</div>

---

## The problem

AI agents reach production faster than anyone can govern them. One unattended loop can burn a budget overnight; one bad write can wipe a database; a long task can fail silently with no trace of why. So most teams either babysit their agents or keep them out of production entirely.

**HIVE makes an agent swarm safe to run.** It is a glass control room: every time an agent has a thought, claims a task, spends money, or trips a safety gate, it writes a row to Postgres, and that write *is* the broadcast. You watch the swarm think because the swarm thinking and the swarm rendering are the same event stream. And because it is observable, it is also **interruptible and accountable**: you can pause it, steer it, raise its budget, approve or deny a high-impact step, and read a full causal record of everything it did.

## The signature moment

A worker reaches a consequential step. The swarm **stops itself and asks**. Nothing runs until you decide. You approve (or inject a constraint and then approve), and it continues, live, on the real backend.

<div align="center">
<img src="docs/media/deck-gate.png" width="820" alt="The risk gate: a high-impact step held for approval, the swarm frozen until you decide" />
</div>

## Every InsForge primitive, composed into one living system

This is the point of the project: not one primitive used well, but the **whole platform** wired into a single product. Every row below is real and exercised on each run.

| InsForge primitive | Role in HIVE |
| --- | --- |
| **Postgres** | The message bus, task queue, and memory. `missions` (budget, spend, step count, guidance), `tasks` (a dependency DAG with per-task cost and a risk flag), `events` (append-only log), `memories`, `interventions` (the steering queue). |
| **Edge function** | A **single** `orchestrator` function runs the whole swarm. (InsForge blocks function-to-function calls with HTTP 508, so the planner, workers, critic, and assembler all run inline in one race-safe tick.) |
| **AI gateway** | All reasoning and embeddings, through an **InsForge-managed OpenRouter key** with per-project spend caps and usage logging. GPT-4o plans, reviews, and assembles; Claude 3.5 Haiku does the work; `text-embedding-3-small` powers memory. |
| **pgvector** | Shared swarm memory. Agents store what they learn; later agents recall it by meaning (`match_memories` RPC). |
| **Realtime** | A database trigger publishes every `events` row to channel `mission:{id}`. The board, the cost meter, and the gate prompt all react live. |
| **Auth** | Missions are scoped to the signed-in user via RLS (anonymous runs allowed). |
| **Storage** | The final deliverable is written to the `artifacts` bucket and opened or downloaded straight from the cockpit. |
| **Hosting** | The site is deployed through InsForge deployments. |

## The swarm

Six agents, four roles, all executed by the same `orchestrator` tick with different prompts and behaviors.

- **Planner** (amber) decomposes the goal into a 4 to 7 task dependency DAG, and tags one high-impact step as a risk.
- **Workers** (cyan, three of them) claim ready tasks in parallel, recall relevant memories from pgvector, reason through the AI gateway, write results, and store new memories.
- **Critic** (magenta) reviews completed work and can bounce a task back with feedback. A convergence cap (one retry, then accept) means it can hold a high bar without ever looping forever.
- **Assembler** (green) composes the accepted outputs into one artifact and uploads it to Storage.

## The control tower

Three subsystems turn the swarm from a black box into something you can govern, observe, and steer, all enforced in the backend and surfaced in the cockpit.

- **Gate engine (the circuit breaker).** Each mission carries a cost budget and a step cap, and the planner tags one high-impact step. The orchestrator checks all three at the top of every tick, before any dispatch. Hit the budget or step cap and the mission pauses; reach the risk step and it holds for explicit approval.
- **Steering control plane (live human control).** Every cockpit action (pause, resume, raise budget, kill a task, approve or deny a gated step, inject a constraint) inserts an `interventions` row and kicks the orchestrator, which drains the queue and applies each one with guarded, idempotent updates. Injected constraints are appended to the mission guidance and the agents re-plan around them.
- **Causal inspector (the flight recorder).** Click any task to see why it ran (its dependencies and recalled memories), its rendered output, its live cost, and the chain of events that touched it.

<div align="center">
<img src="docs/media/deck-board.png" width="820" alt="The live mission board: a dependency DAG of glass task cards with per-status treatments and a streaming activity feed" />
</div>

## Architecture

```
   you type a goal ──▶ Auth ──▶ insert mission row (Postgres)
                                          │
                                          ▼
                          ┌───────────────────────────────┐
                          │  orchestrator (single edge fn) │
                          │  one race-safe tick:           │
                          │   1. drain interventions       │
                          │   2. enforce budget/step/risk  │
                          │   3. dispatch ready tasks       │
                          └───────────────┬───────────────┘
              planner / workers / critic / assembler run inline
                    │ reason via AI gateway · recall+store pgvector
                                          ▼
                  Postgres: tasks advance, events appended
                                          │ trigger
                                          ▼
                      realtime.publish ──▶ mission:{id}
                                          ▼
        browser: realtime ─▶ zustand store ─▶ live deck (DAG, cost, gate)
                                          │
                          artifact ─▶ Storage bucket ─▶ download
```

The orchestration is tick based, so nothing runs forever. On each tick the orchestrator finds tasks whose dependencies are met, claims them atomically (`UPDATE ... WHERE status = 'pending'`, so two ticks never grab the same task), and runs the workers. Every transition is a guarded atomic UPDATE, which makes re-invocation idempotent and the whole thing race-safe. The browser kick, the post-intervention kick, and a cron sweep all re-invoke it; a hard pass cap bounds every run.

## Built with

- **Frontend:** React 19 + Vite + TypeScript, a [Zustand](https://github.com/pmndrs/zustand) store fed by InsForge realtime, and the **HIVE Design System** (a cinematic, luminous, motion-first dark system: Space Grotesk + Geist Mono, role-colored spectrum, glass nodes, GPU-friendly motion). No component library, no template aesthetic.
- **Backend:** InsForge (Postgres, edge functions, AI gateway, pgvector, realtime, auth, storage), Deno orchestrator, OpenRouter-via-InsForge models.

## Run it

Prerequisites: Node 20+.

```bash
npm install
npm run dev
```

Open the deck with the simulation flag to watch a full mission run end to end with **no backend required**:

```
http://localhost:5173/?sim
```

The simulation replays a mission through the exact same event pipeline and reducer the live backend uses, so what you see offline is what the live swarm produces. To run against a real InsForge project, set `VITE_INSFORGE_URL` and `VITE_INSFORGE_ANON_KEY`, then launch a mission from the deck. Full live deployment steps (migrations, function deploy, AI key setup, site deploy) are in [`docs/deploy.md`](docs/deploy.md).

## Quality bar

Held to a product standard, not a hackathon standard.

- TypeScript strict across the codebase. `tsc`, `eslint` (0 issues), and the unit suite (40 tests over the reducer and orchestration logic) are all green and gate every change.
- Validated live in a real browser: the full mission lifecycle (launch, parallel work, pgvector recall, a critic bounce, a risk gate, live steering, a shipped artifact) renders on the deployed backend with zero console errors.
- The whole InsForge stack mutates on every run, provably: a single launch writes a mission row, advances a task DAG, streams hundreds of events, stores vector memories, applies a human steering intervention, and uploads a real artifact.

## Repository layout

```
hive/
  src/
    ui/           the live control deck + the cinematic landing
      design/     the HIVE Design System: tokens + 12 typed primitives
    state/        the zustand swarm store, the realtime->deck adapter, the simulation
    lib/          the InsForge client, the mission + steering API, the swarm protocol
  functions/
    orchestrator  the single edge function: the race-safe gated tick that runs every role
  migrations/     SQL: tables, RLS, the realtime publish trigger, pgvector, the control tower
  docs/           deploy guide + media
```

<div align="center">

**Agents you can trust in production.** Hand them a goal, watch them work, and stay in command.

</div>
