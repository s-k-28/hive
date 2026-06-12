<div align="center">

# HIVE

### Your backend is alive.

Give a goal to a swarm of AI agents that live entirely inside InsForge. Watch them plan, execute, review their own work, and ship the result, in real time, rendered as a cinematic 3D mission control.

Built for the InsForge Hack, June 2026. Target track: Most Technically Impressive.

</div>

---

## The one-liner

Most agent demos hide the agents behind a chat box. HIVE turns the swarm inside out. The database is the message bus, the task queue, and the shared memory. Every time an agent has a thought, claims a task, stores a memory, or finishes work, it writes a row to Postgres, and that write is the broadcast. You see the swarm think because the swarm thinking and the swarm rendering are the same event.

There is no separate backend server. The agents are InsForge edge functions. Their reasoning is the InsForge AI gateway. Their memory is pgvector. Their nervous system is InsForge realtime. The whole thing is hosted on InsForge.

## How HIVE uses every InsForge primitive

| Primitive | Role in HIVE |
| --- | --- |
| Postgres | `missions`, `tasks` (a dependency DAG), `agents`, `events` (append only log), `memories` |
| Edge functions | `orchestrator` (a cron tick that assigns ready tasks) and `agent-run` (claim, reason, act, report) |
| AI gateway | All agent reasoning and all embeddings, through the OpenAI compatible project endpoint |
| pgvector | Shared swarm memory. Agents store what they learn, later agents recall it by meaning |
| Realtime | A database trigger publishes every `events` row to `mission:{id}`. The 3D scene reacts live |
| Auth | Missions are scoped to the signed in user |
| Storage | The final deliverable is written to a bucket and downloaded straight from the UI |
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

The simulation replays a real mission through the exact same event pipeline the live backend uses, so what you see in `?sim` is what the live swarm produces.

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
    ui/           glass overlay: mission console, live log, roster, progress, artifact
    lib/          InsForge client and the swarm protocol shared with the functions
  functions/
    orchestrator/ the cron tick that assigns ready tasks
    agent-run/    claim, reason via the AI gateway, report, store memory
  migrations/     SQL: tables, RLS, the realtime publish trigger, pgvector
  docs/           research brief, r3f playbook, InsForge cheat sheet, deploy guide
```

## Judging dimensions, addressed directly

- **Technical execution.** Eight InsForge primitives composed into one coherent system, a race safe tick orchestrator, pgvector memory recall, trigger based realtime, all tested.
- **Design quality.** A custom 3D interface and a hand built glass UI, no component library, no template aesthetic.
- **Potential impact.** Transparent delegation. You hand a goal to a team of agents and watch them work, with receipts, instead of trusting a black box.
- **Idea quality.** The backend is the product. The thing that streams the agents to you is the same thing that runs them.
