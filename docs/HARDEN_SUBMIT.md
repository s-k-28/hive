# HIVE Follow-up: harden the live product and make it submission-ready

The HIVE control tower is built and deployed live on InsForge with a hosted URL.
Now make it robust under real use, safe to expose publicly, polished, and
judge-grade. Work in https://github.com/s-k-28/hive. No em-dashes anywhere.
Never commit a secret value. Keep lint, build, and all tests green, with zero
console errors, before you push. Read docs/PRD.md (Phases 3 and 4) for intent.

## Job 1: Live robustness QA
On the hosted URL, run at least five real missions with varied goals (a
go-to-market plan, a competitive brief, a technical outline, a research summary,
and one deliberately vague goal). For each, confirm end to end on the live board:
the plan appears, the cost meter climbs, the risk gate pauses with the
GatePrompt, you approve and inject and raise budget and kill and it adapts, the
Inspector opens on a card, the mission completes, the artifact opens and
downloads, and the run shows up in history. Fix every live bug you hit. Zero
console and zero page errors across all five.

## Job 2: Real-world edge cases (handle gracefully, never hang or crash)
- The AI returns unparseable JSON for the plan or the critic verdict: the
  existing fallbacks must hold. Verify and harden them.
- A 429, spend-cap, or transient gateway error: the per-call retry absorbs
  transients; a persistent failure must end the mission with a clear
  mission_failed and a readable reason on the board, never a silent hang.
- A vague or tiny goal: the planner must still produce a sensible small plan, not
  junk and not an empty plan.
- Long runtime (a real mission is 30 to 120 seconds): the board must always show
  honest progress and never look frozen. Add a subtle working state and an
  elapsed indicator if either is missing.
- A killed task that blocks dependents: the mission still terminates cleanly (the
  assembler composes from accepted tasks, or it fails with a clear reason).

## Job 3: Make the public URL safe to share
A public URL spends real AI credits, so add guardrails enforced server-side (at
mission create or in the orchestrator), not just in the UI:
- A hard per-mission budget ceiling (the existing budget) plus a per-user, or
  per-anonymous-session, daily mission cap. On exceed, show a friendly "daily
  limit reached" message and do not start a run.
- On a 429 or project spend cap from the gateway, show a clear "service is busy,
  try again later" message, not a stack trace.

## Job 4: Onboarding and responsiveness
- First-time empty state: a clear one-line "what this is", the three example
  goals, and a one-line "what happens when you launch" hint, so a stranger
  understands it in seconds.
- Responsive: the board, the control bar, the gate prompt, and the inspector must
  be usable on a 13-inch laptop at minimum and must not break or overflow on a
  smaller window. If you gate very small screens, show a clear "best on desktop"
  message rather than a broken layout.

## Job 5: Make the repo judge-grade
- The README leads with the hosted URL prominently, a two-line "try it", and the
  "how HIVE uses every InsForge primitive" table, kept accurate to what is
  actually deployed.
- Update docs/deploy.md to mark the previously UNVERIFIED items as resolved,
  recording what actually worked live (the import form, the realtime payload
  shape, the pgvector form, the dispatch behavior).
- Confirm the repo is public and contains no secret values.

## Verification and delivery
- Full gauntlet green: npm run lint && npm run build && npx vitest run.
- Live QA on the hosted URL for all five missions, with screenshots of the
  gate-and-steer moment and a completed artifact.
- Commit with messages ending in
  Co-Authored-By: Claude <noreply@anthropic.com>. Scan the diff for
  secret-shaped strings (ik_, sk-, sk-or-, gho_, AKIA) before pushing. Push to
  origin (https://github.com/s-k-28/hive); the repo stays public.
- Report: the hosted URL, the five-mission result, every bug you fixed, and the
  resolved deploy.md items.

Make it something a judge can open cold, understand in ten seconds, and run
without it breaking or draining the account.
