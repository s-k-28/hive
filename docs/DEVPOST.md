# HIVE — Devpost submission copy

Paste-ready copy for the InsForge Hack submission. Live: https://nmf6vbv4.insforge.site · Repo: https://github.com/s-k-28/hive

---

## Tagline (one line)

The live control tower for AI agents: run a team of agents you can see, stop, and steer, entirely on InsForge.

## Elevator pitch (2 sentences)

HIVE turns an autonomous agent swarm from a black box into a glass control room. You hand it a goal, watch a transparent team plan, execute in parallel, and review its own work in real time, with a live cost meter, hard risk gates that stop and ask before any high-impact step, and one-click intervention, all powered by the whole InsForge platform.

---

## Inspiration

AI agents reach production faster than anyone can govern them. One unattended loop can burn a budget overnight; one bad write can wipe a database; a long task can fail silently with no trace of why. So teams either babysit their agents or keep them out of production. We wanted the opposite: a swarm you can actually trust to run, because you can see everything it does, stop it mid-flight, and audit exactly why it acted. The insight that started HIVE: if the database is the message bus, then the act of an agent writing its result *is* the broadcast, so the thing that runs the swarm and the thing that streams it to you can be one and the same.

## What it does

You give HIVE a goal. A planner agent decomposes it into a dependency-aware task graph and spawns the swarm. Worker agents claim ready tasks in parallel, recall relevant memories from a shared vector store, reason through an AI gateway, and write results. A critic reviews every result and can bounce weak work back for a retry. An assembler composes the accepted outputs into a finished, downloadable artifact.

The whole run is governed and steerable:

- A **live cost meter** and step counter, metered per task.
- **Hard gates**: a budget cap, a step cap, and a risk gate on the one high-impact step, all enforced in the backend before any work is dispatched. Trip one and the swarm pauses and asks you.
- A **steering control plane**: pause, resume, raise the budget, kill a task, approve or deny a gated step, or inject a constraint the agents re-plan around, all live, mid-run.
- A **causal inspector**: click any task to see why it ran (its dependencies and recalled memories), what it produced, and what it cost.

## How we built it

HIVE runs entirely on InsForge, with every primitive composed into one living system:

- **Postgres** is the message bus, task queue, and memory: missions, a tasks DAG, an append-only events log, vector memories, and a steering interventions queue.
- A **single edge function** (`orchestrator`) runs the whole swarm as a race-safe tick. Every transition is a guarded atomic UPDATE, so re-invocation is idempotent and two ticks never collide.
- The **AI gateway** (an InsForge-managed OpenRouter key with per-project spend caps and usage logging) powers all reasoning and embeddings: GPT-4o plans, reviews, and assembles; Claude 3.5 Haiku does the work.
- **pgvector** is the shared swarm memory: agents store what they learn and later agents recall it by meaning.
- **Realtime** is the nervous system: a database trigger publishes every events row to a per-mission channel, and a Zustand store on the client reduces them into the live deck.
- **Auth** scopes missions to the user, **Storage** holds the final artifact, and the site is **hosted** on InsForge.

The frontend is React 19 + Vite + TypeScript with a custom design system (Space Grotesk + Geist Mono, a role-colored luminous spectrum, glass nodes, GPU-friendly motion). The backend connects to it through a thin adapter, so the cinematic UI is a pure window onto real backend state.

## Challenges we ran into

- **InsForge blocks function-to-function calls (HTTP 508).** Our first design had an orchestrator that fanned out to a separate worker function. When we hit the 508, we collapsed the entire swarm into a single function that runs every role inline within one race-safe tick. It made the system simpler and faster.
- **Getting the AI gateway right.** InsForge's older project `/v1` endpoint is deprecated; the current official pattern is to call OpenRouter directly with an InsForge-managed key (which carries the per-project spend cap and usage logging). We routed all reasoning through that, so the spend you see in the cost meter is real and capped by the platform.
- **Making realtime the architecture, not a feature.** A trigger that publishes every events row means oversight is not bolted on the side: the swarm thinking and the swarm rendering are the same event stream.
- **A late design-system merge, with zero backend changes.** We swapped the entire frontend for a finished cinematic design system and wired it to the proven backend through one adapter. Validating it live caught a real React render-loop crash (a selector returning a fresh object graph looped `useSyncExternalStore`), which we fixed by deriving state from raw store slices.

## Accomplishments that we're proud of

- The **whole InsForge platform** composed into one coherent product, not one primitive used well.
- A **race-safe, idempotent, gated** tick orchestrator with per-step cost accounting, pgvector recall, and a convergence-capped critic.
- **Agents you can actually trust in production**: stop them, steer them, and read a full causal record, all provably real (a single launch mutates the whole stack: a mission row, a task DAG, hundreds of events, vector memories, a human intervention, and a real artifact in Storage).
- A **cinematic, custom design** with no component library and no template aesthetic, validated live end to end with zero console errors.

## What we learned

- When the database is the broadcast, observability stops being a separate system and becomes the architecture.
- Governance (budgets, gates, steering, a causal record) is the missing layer that makes production agents viable, and it is more compelling than yet another autonomous demo.
- A clean adapter seam between a design system and a live backend let the UI and the backend evolve in parallel without stepping on each other.

## What's next

- Multi-user co-steering of a single mission.
- Re-arming the proven live-browser research tool, so workers can read real pages mid-mission.
- Replay and branch: fork a past mission from any point with a new constraint.
- More gate types and richer per-task provenance.

## Built with

`insforge` · `postgres` · `pgvector` · `edge-functions` · `realtime` · `openrouter` · `gpt-4o` · `claude-3.5-haiku` · `react` · `typescript` · `vite` · `zustand` · `deno`
