<div align="center">

# HIVE

### The live control tower for AI agents.

Run a team of AI agents you can see, stop, and steer in real time. Give them a goal, watch them plan, execute, review their own work, and ship the result, rendered as a cinematic 3D mission control, with a live cost meter, hard safety gates, and a flight recorder for every decision. It all runs entirely inside InsForge.

Built for the InsForge Hack, June 2026.

</div>

---

## The one-liner

AI agents cannot be trusted in production because they run away (a documented $47K loop), cause irreversible damage (the Replit agent wiped a live database despite a freeze), fail silently on long tasks, and give no causal trace of why they acted. 74% of production agents get rolled back, and the EU AI Act's human-oversight rules are enforceable in August 2026.

HIVE is the answer: a governed, observable, steerable control tower. The database is the message bus, the task queue, the shared memory, and the steering plane. Every time an agent has a thought, claims a task, spends money, or trips a safety gate, it writes a row to Postgres, and that write is the broadcast. You see the swarm think, and you stop or steer it, because the swarm thinking and the swarm rendering are the same event stream.

There is no separate backend server. The agents are InsForge edge functions. Their reasoning is the InsForge AI gateway. Their memory is pgvector. Their nervous system is InsForge realtime. The whole thing is hosted on InsForge.

## Why this matters

AI agents do more real knowledge work every month, but they cannot be trusted in production. They run away and burn money, they take irreversible actions no one approved, they fail silently on long tasks, and they give no causal trace of why they acted. That is why most production agents still get rolled back, and why human-oversight rules are becoming law.

HIVE makes an agent swarm safe to run. Three subsystems sit on top of the engine:

- **The gate engine (circuit breaker).** Every mission carries a cost budget, a step cap, and a risk gate on high-impact steps, all enforced in the orchestrator before any work is dispatched. Trip a limit and the swarm pauses and asks you, instead of burning money or doing damage.
- **The steering control plane.** From the cockpit you pause and resume, raise the budget, kill a task, approve or deny a gated action, and inject a constraint the agents re-plan around, all live, mid-run.
- **The causal inspector (flight recorder).** Click any node to see why it ran (its dependencies and recalled memories), what it produced (rendered markdown), and what it cost, plus a live cost meter and the final downloadable artifact.

You still watch every agent reason in plain language, see which earlier findings each one recalls from shared memory, and watch a critic reject weak work and send it back before anything ships. Now you can also stop it, steer it, and audit it. The 3D mission control is how that control is made tangible: the swarm thinking and the swarm rendering are the same event stream, so oversight is not bolted on the side, it is the architecture.

## How HIVE uses every InsForge primitive

| Primitive | Role in HIVE |
| --- | --- |
| Postgres | `missions` (with budget, spend, step count, guidance), `tasks` (a dependency DAG with cost and a risk gate), `events` (append only log), `memories`, `interventions` (the steering queue) |
| Edge functions | `orchestrator` (a race-safe tick that drains interventions, enforces the gates, then assigns ready tasks) and `agent-run` (claim, reason, act, report, account for cost) |
| AI gateway | All agent reasoning and all embeddings, through the OpenAI compatible project endpoint, with per-step token cost metered live |
| pgvector | Shared swarm memory. Agents store what they learn, later agents recall it by meaning |
| Realtime | A database trigger publishes every `events` row to `mission:{id}`. The 3D scene, the cost meter, and the gate prompt all react live |
| Auth | Missions are scoped to the signed in user, with a "your missions" history that replays a past run |
| Storage | The final deliverable is written to a bucket and opened, copied, or downloaded straight from the UI |
| Hosting | The site itself is deployed on InsForge |

This is the point of the project: not one primitive used well, but the whole platform composed into a single living system.

## Architecture

```
            you  type a goal   Auth (InsForge)   insert mission row
                                                              |
                                                              v
                                              +-----------------------------+
                                              |  orchestrator  (edge fn)     |
                                              |  cron tick: find ready tasks |
                                              |  race-safe claim + dispatch  |
                                              +---------------+-------------+
                                                              | invokes
                                          +-------------------+-------------------+
                                          v                   v                   v
                                   agent-run            agent-run            agent-run
                                  (planner)            (worker)             (critic)
                                      |                    |                    |
                  recall memory <-----+   reason via       |   store memory     |
                   (pgvector)         |   AI gateway       +-----> (pgvector)    |
                                      v                    v                    v
                              +--------------------------------------------------+
                              |   Postgres: tasks advance, events appended        |
                              +---------------------------+----------------------+
                                                          | INSERT on events
                                                          v
                                              trigger -> realtime.publish
                                                          |  channel mission:{id}
                                                          v
                              +--------------------------------------------------+
                              |   Browser: realtime subscription -> zustand store |
                              |     +-> 3D scene  (transient reads, 60fps)        |
                              |     +-> glass overlay (reactive selectors)        |
                              +--------------------------------------------------+
                                       artifact -> Storage bucket -> download
```

The orchestration is tick based. Nothing runs forever. On each tick the orchestrator finds tasks whose dependencies are met, claims them atomically (`UPDATE ... WHERE status = 'pending'` so two ticks never grab the same task), and fires the worker invocations. Failures increment a retry counter and emit an error event. When every task is accepted, the assembler composes the artifact.

## The swarm

Six agents, four roles, all executed by the same `agent-run` edge function with different prompts and behaviors.

- **Planner** (gold). Decomposes the goal into four to seven tasks with explicit dependencies.
- **Workers** (cyan, three of them). Claim ready tasks, recall relevant memories from pgvector, reason through the AI gateway, write results, and store new memories.
- **Critic** (magenta). Reviews completed work. Can bounce a task back with feedback, which the scene shows as a red pulse traveling back to the task node.
- **Assembler** (green). Composes the accepted task outputs into the final artifact and uploads it to Storage.

## The control tower

Three subsystems turn the swarm from a black box into something you can govern, observe, and steer, all enforced in the backend and surfaced in the cockpit.

- **Gate engine (the circuit breaker).** Each mission carries a cost budget and a step cap, and the planner tags one high-impact step as a risk. The orchestrator checks all three at the top of every tick, before any dispatch. Hit the budget or the step cap and the mission pauses; reach the risk step and it holds for explicit approval. The energy core visibly strains as the budget is spent.
- **Steering control plane (live human control).** Every cockpit action (pause, resume, raise budget, kill a task, approve or deny a gated step, inject a constraint) inserts an `interventions` row and kicks the orchestrator, which drains the queue and applies each one with guarded, idempotent updates. Injected constraints are appended to the mission guidance and the agents re-plan around them.
- **Causal inspector (the flight recorder).** Click any task node to see why it ran (dependencies and recalled memories), its rendered-markdown output, its cost, and the ordered chain of events that touched it. A live cost meter and step counter sit in the control bar, and the final artifact opens in-app to copy or download.

The signature moment is simple: a gate trips, the swarm stops and asks, and you steer it forward, all in real time, all rendered in the 3D scene.

## The 3D mission control

react-three-fiber, drei, and postprocessing. One scene, three signature animations driven entirely by swarm events.

1. **Task graph bloom in.** When the planner finishes, the task nodes materialize around the central goal core with animated light beam edges.
2. **Thought streams.** While an agent works, particles flow along a curve from its orb to the task node, and its reasoning streams into the mission log.
3. **Memory constellation.** Every stored memory ignites a new star in a background galaxy. Semantic recall draws light threads from those stars back to the agent that remembered. Mission completion fires a full scene bloom burst.

Agent state drives everything. Idle is a slow orbit, thinking is a pulse with a particle halo, complete is a bright flash, error is a red shockwave. The camera auto orbits and smoothly focuses any agent you click. Performance is held at 60fps with an instanced constellation, capped draw calls, and a clamped device pixel ratio.

## Run it

Prerequisites: Node 20 or newer.

```bash
npm install
npm run dev
```

Then open the app with the simulation flag to watch a full scripted mission run end to end with no backend required:

```
http://localhost:5173/?sim
```

The simulation replays a real mission through the exact same event pipeline the live backend uses, so what you see in `?sim` is what the live swarm produces. It climbs the cost meter, trips the risk gate so the swarm stops and asks, and resumes when approved, all offline. Every steering control (pause, resume, raise budget, kill, approve, deny, inject) works in the simulation too.

### Live mode (on InsForge)

```bash
npx @insforge/cli login
npx @insforge/cli link
# apply migrations, deploy functions, set the AI gateway secret, deploy the site
```

Full live deployment steps are in [`docs/deploy.md`](docs/deploy.md).

## Quality bar

This project is held to a product standard, not a hackathon standard.

- TypeScript strict across the whole codebase. Lint and typecheck are green.
- Unit tests cover the swarm reducer (every event type, ordering, deduplication, failure paths) and the orchestration logic. Tests passing is a release gate.
- Zero console errors. No dead UI states. Every realtime event type has a rendered consequence.
- 60fps on a laptop, verified.

## Repository layout

```
hive/
  src/
    scene/        3D mission control (r3f): core, agent orbs, task graph, constellation, effects
    state/        zustand stores fed by realtime events, plus the local simulation
    ui/           glass overlay: console, control bar, gate prompt, inspector, log, roster, artifact, auth, history
    lib/          InsForge client, auth + steering helpers, and the swarm protocol shared with the functions
  functions/
    orchestrator  the tick: drains interventions, enforces the gates, assigns ready tasks
    agent-run     claim, reason via the AI gateway, report, store memory, account for cost
  migrations/     SQL: tables, RLS, the realtime publish trigger, pgvector, the control tower schema
  docs/           research brief, r3f playbook, InsForge cheat sheet, deploy guide
```

## Judging dimensions, addressed directly

- **Technical execution.** The whole InsForge platform composed into one coherent system, a race safe and idempotent tick orchestrator that drains a steering queue and enforces three kinds of gate, per-step cost accounting, pgvector memory recall, trigger based realtime, all tested.
- **Design quality.** A custom 3D interface and a hand built glass cockpit, no component library, no template aesthetic, with instant legible feedback for every control.
- **Potential impact.** Agents you can trust in production. You hand a goal to a team of agents and watch them work, with a budget, hard gates, live steering, and a full causal record, instead of trusting a black box.
- **Idea quality.** The backend is the product. The thing that streams the agents to you is the same thing that runs them, governs them, and lets you steer them.
