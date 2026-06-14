# HIVE demo script (sub-3-minute, narrated)

The single most important hackathon asset. Research across winning hackathons is
consistent: judges reward a flawless, well-told demo over a pile of features.
This script is tuned to the patterns that win agent hackathons in 2025-2026 —
**autonomous teammates that observe, decide, and act, with safety checks, cost
diagnostics, and risk control** — which is exactly what HIVE is.

Record at 1280x720 minimum. Pre-warm one live run before recording so models are
hot and the artifact is cached. Have a fallback: `?sim` plays the same beats
offline if the network is flaky during recording.

**Narrate the InsForge integration out loud at least twice** (once on the live
mission board reacting to realtime, once on the dashboard showing rows change).

---

## 0:00 – 0:20 — The problem (cold open, no logo card)

> "AI agents are powerful and impossible to trust in production. They run away
> and burn thousands of dollars. They take irreversible actions nobody approved.
> And when it goes wrong, there's no trace of why. Most teams roll them back."

On screen: the HIVE landing page, then click into the deck. Keep it moving.

## 0:20 – 0:55 — Launch (lead with the flagship: point it at a real repo)

> "HIVE runs a team of agents you can see, stop, and steer. Watch. I'll point it
> at a real GitHub repo and ask it to review the codebase."

- Paste a public repo (`owner/repo`) into **Connect repo** — no token, instant.
- Type the goal: *"Review this codebase and propose the highest-impact fixes."*
- The **clarifier** asks two sharp questions; answer them. Note it recommends the
  specialists it will assign.
- Set the budget to a tight number. Click **Launch swarm**.

## 0:55 – 1:30 — Observe (it's alive, and every node is a Postgres row)

> "The swarm forms. The planner clones the repo read-only, splits the work, and
> assigns each task a specialist — a Security Auditor here, a Code Reviewer there.
> Every card you see is a row in Postgres, and every move is an InsForge realtime
> event. The swarm thinking and the swarm rendering are the same event stream."

- Point at the **cost meter** climbing and the **step counter**.
- Click a task node → the **causal inspector**: why it ran (its dependencies and
  the memories it recalled), what it produced, and what it cost.

## 1:30 – 2:10 — The money shot (it stops itself, then you steer it)

> "Now the important part. The riskiest step — publishing the report — is gated.
> The swarm stops itself and asks me before it acts."

- The **risk gate** trips; the held card pulses amber; the gate prompt rises.
- Steer live: **inject a constraint** ("keep it to one page"), then **approve**
  the gate. (Optionally show **raise budget** if it nears the cap.)

> "It stopped before doing the risky thing, asked a human, and adapted to my
> constraint. That's oversight built into the architecture, not bolted on."

## 2:10 – 2:40 — Finish (a real, useful artifact)

- The assembler composes the deliverable; **mission completes under budget**.
- Open the **artifact** in-app: a real, readable code-review report with ranked,
  file-level fixes. Copy or download it.

> "A real review, produced by a team of agents, under a budget, with a hard
> safety gate and a full causal record of every decision."

## 2:40 – 3:00 — It all runs on InsForge (close strong)

Cut to the InsForge dashboard:

- The `events` table streaming rows; the `mission:{id}` realtime channel; the
  `orchestrator` function; the `memories` vectors; the artifact in Storage.

> "The agents, their memory, their governance, and this whole control tower run
> entirely on InsForge. No separate backend. The thing that streams the swarm to
> you is the same thing that runs it, governs it, and lets you steer it."

End on the hosted URL on screen. Stop talking. Let it land.

---

## Shot list / checklist

- [ ] Pre-warmed live run; artifact cached; budget set low enough to trip a gate.
- [ ] Public repo chosen that reads well (clear README, recognizable name).
- [ ] Clarifier answered crisply (don't fumble typing on camera).
- [ ] Inspector opened on a node that recalled a memory (shows the recall thread).
- [ ] Gate trip is the visual peak — pause on it, don't rush.
- [ ] InsForge dashboard tab open and logged in before recording.
- [ ] Hosted URL visible in the final frame.

## One-sentence pitch (for the submission form)

> HIVE is the live control tower for AI agents: hand a goal — or a GitHub repo —
> to a team of specialist agents and watch them plan, execute, review, and ship,
> with a live cost meter, hard safety gates that stop the swarm before it does
> damage, and full live steering, all running entirely on InsForge.
