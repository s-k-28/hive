# HIVE

**Your backend is alive.** Type a goal. A swarm of AI agents living entirely inside InsForge wakes up, splits the work, reviews itself, and ships the result, while you watch every thought in a cinematic 3D mission control.

Built for the InsForge Hack (deadline June 14, 2026). Target track: Most Technically Impressive.

## Why this is technically impressive

The swarm has no server of its own. Every part of it is an InsForge primitive:

| InsForge primitive | Role in Hive |
|---|---|
| Postgres | `missions`, `tasks` (dependency DAG), `agents`, `events` |
| Edge functions | `orchestrator` (tick: assigns ready tasks), `agent-run` (claim, think, act, report) |
| AI gateway | All agent reasoning and embeddings, via the OpenAI-compatible project endpoint |
| pgvector | Shared swarm memory: agents store learnings, later agents semantically recall them |
| Realtime | Database triggers publish every event row to a per-mission channel; the 3D scene reacts live |
| Auth | Missions are scoped to signed-in users |
| Storage | The final deliverable is written to a bucket and downloadable from the UI |
| Hosting | The site itself is deployed on InsForge |

The database is the message bus, the task queue, and the memory. The trigger-based realtime path means the act of an agent writing its result IS the broadcast.

## The swarm

Roles, all executed by the same `agent-run` edge function with different prompts:

- **Planner** (gold): decomposes the mission into 4-7 tasks with dependencies.
- **Workers** (cyan): claim ready tasks, recall relevant pgvector memories, reason via the AI gateway, write results, store new memories.
- **Critic** (magenta): reviews completed work; can send a task back with feedback (visible as a red edge in the scene).
- **Assembler**: composes the final artifact from accepted task outputs, uploads to Storage.

Orchestration is tick-based. No long-running processes: each tick, the orchestrator finds tasks whose dependencies are met and fires worker invocations. Claims are race-safe (`UPDATE ... WHERE status = 'pending'`). Failures increment a retry count and emit error events.

## The 3D mission control

react-three-fiber + drei + postprocessing. One scene, three signature animations:

1. **Task graph bloom-in**: when the planner finishes, task nodes materialize around the central goal core with animated light-beam edges.
2. **Thought streams**: particles flow along curves from agent orbs to task nodes while an agent works; the mission log overlay streams its reasoning text live.
3. **Memory constellation**: each stored memory becomes a star in a background galaxy; semantic recall draws a light thread from the constellation to the recalling agent. Mission completion fires a full-scene bloom burst.

Agent state drives everything: idle = slow orbit, thinking = pulse + halo, done = flash, error = red shockwave. Glassmorphic HTML overlay carries the mission input, live log, and progress. Slow auto-orbit camera; click an agent to focus.

## Quality bar

- TypeScript strict, lint and typecheck green, zero console errors.
- 60fps on a MacBook: instanced constellation, capped draw calls, clamped dpr.
- Every realtime event type rendered; no dead UI states.
- Demo video under 3 minutes: name, live mission run, InsForge dashboard cut showing tables/functions/vectors filling, hosted URL reveal.

## Repo layout

```
hive/
  src/                  # Vite + React 19 + TS frontend
    scene/              # r3f scene: core, agents, taskgraph, constellation, fx
    state/              # zustand stores fed by realtime events
    ui/                 # HTML overlay: mission input, log, progress
    lib/                # InsForge client, types shared with functions
  functions/
    orchestrator/       # tick: assign ready tasks
    agent-run/          # claim, think (AI gateway), act, report
  migrations/           # SQL: tables, RLS, realtime triggers, pgvector
  SPEC.md
```
