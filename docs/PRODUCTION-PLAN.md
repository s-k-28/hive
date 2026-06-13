# HIVE: from demo to a product a real person can use

This is the honest gap analysis. It separates what is real from what is staged,
defines the actual user journey we are building toward, and lists everything
that must be built or fixed to get there, in dependency order.

## 1. The honest current state

What is real today:
- The 3D scene, the glass UI, and the event-driven state layer are real and work.
- The swarm protocol, the reducer (25 passing tests), and the local simulation are real.
- The InsForge backend (4 migrations, 2 edge functions) is written and reviewed, but has never run against a live project.

What is staged or missing:
- **The default experience is a scripted movie.** With no InsForge env configured, `MissionConsole` calls `startMission()` which falls back to `runSimulation()`. Every goal you type plays the identical hardcoded launch-plan script. The goal text shows in the header; the tasks, reasoning, and artifact are canned. Different input, same output.
- **Nothing is deployed.** No InsForge project is linked, no migrations applied, no functions deployed, no storage bucket, no secrets, no hosted URL. The live path has never executed once.
- **There is no user.** Auth is unwired (the overlay exposes an `onSignIn` prop that `App` never passes). Everything is anonymous.
- **There is no payoff.** When a mission "completes," the artifact is a tiny chip linking to a storage URL (a placeholder `#` in sim). You cannot read, preview, copy, or meaningfully use the deliverable in the app.
- **There is no memory across sessions.** Run a mission, close the tab, it is gone from the UI. No "my missions" list, no reopening, no history.

Bottom line: a user cannot use this. The first job is to make a single real mission work end to end on live InsForge, then build the product around that loop.

## 2. What "a user can actually use it" looks like (target flow)

1. User lands on the hosted URL (`hive.<...>.insforge.site`).
2. User signs in (email or OAuth). Their missions are now theirs.
3. User types a real goal ("Write a go-to-market plan for my Postgres analytics tool").
4. A real planner agent decomposes it; real workers research and draft via the AI gateway; a real critic rejects weak work and forces rewrites; results are stored as real pgvector memories; everything streams live to the 3D scene and the log.
5. The mission completes. The user reads the finished deliverable **in the app** (rendered markdown), copies it, downloads it, or shares a link.
6. Later, the user returns, sees their past missions, reopens one, and reuses its artifact.

Everything below exists to make that flow real and trustworthy.

## 3. Plan, in dependency order

### Phase 0 — Provision (blocks everything; needs you)
Owner: you run the auth, I run the rest. From `docs/deploy.md`:
- `npx @insforge/cli login` and `link` a project.
- Apply migrations: `db migrations up --all`. Verify the 4 ran (tables, RLS, pgvector, realtime trigger + `mission:%` channel).
- `ai setup` to get the AI gateway/OpenRouter key.
- Create the `artifacts` storage bucket.
- Set secrets: `OPENROUTER_API_KEY`, `INSFORGE_URL`, `INSFORGE_API_KEY`, `WORKER_TOKEN`, `FUNCTIONS_BASE_URL`, optional `AI_*_MODEL`.
- Deploy both functions (`functions deploy orchestrator`, `agent-run`); copy the real functions base URL into `FUNCTIONS_BASE_URL`.
- Register the cron sweep schedule.
- Set `VITE_INSFORGE_URL` / `VITE_INSFORGE_ANON_KEY` and `deployments deploy .`.

### Phase 1 — Prove the live loop (make ONE real mission work)
This is where the UNVERIFIED assumptions meet reality. Expect real bugs; this is debugging against the live project, not writing new features.
- Confirm `npm:@insforge/sdk` / `npm:openai` import in InsForge Deno (else swap to `esm.sh`).
- Confirm the realtime trigger fires and the browser actually receives `event_created` in the wire shape `mission.ts` expects (the passthrough assumption).
- Confirm anon (or authed) browser can subscribe to `mission:{id}` under the channel RLS policy.
- Confirm pgvector: the embedding insert and `match_memories` RPC accept the array form (else switch to the bracketed-string literal noted in `deploy.md`).
- Confirm function-to-function dispatch survives isolate teardown (M4 in the review); if dispatches drop, add a staleness reaper or rely on the cron sweep.
- Confirm the planner returns parseable JSON, the critic loop converges, and the assembler uploads a real artifact and finalizes the mission.
- Confirm CORS, function timeout limits (a long AI chain must fit), and that a 429 degrades gracefully (the retry + terminal `mission_failed` path).
- Exit criteria: one real goal produces a real, downloadable artifact with the scene animating from live events, zero console errors.

### Phase 2 — Close the user value loop
The features that turn "it ran" into "I got something I can use."
- **Wire auth.** Real sign up / sign in / sign out / session restore using the InsForge auth SDK. Pass it into the overlay (`onSignIn` is already stubbed). Gate mission creation; set `user_id` so RLS scopes missions to the user.
- **Artifact viewer.** Render the finished markdown deliverable in-app (a readable panel), with copy, download, and "open raw." This is the payoff; right now it is a chip.
- **Mission history.** A "your missions" list (query `missions` for the user), with status, date, and reopen. Reopening replays the persisted `events` so the scene and artifact come back.
- **Honest mode labeling.** When no backend is configured, label the experience clearly as a demo/sim so it is never mistaken for real output. In sim, either disable free-text goals or make it explicit that the run is illustrative.

### Phase 3 — Make it usable by a stranger
- **Onboarding / empty state.** A first-time user must understand what this is and what to type. One sentence plus 3 strong example goals (already present) plus a "what happens next" hint.
- **Expectation setting.** A real run takes 30 to 120 seconds across many AI calls. The UI must show honest progress and never look frozen. Handle the slow path, the partial path, and the failed path with clear copy.
- **Output quality.** Tune the planner/worker/critic/assembler prompts so the artifact is genuinely good and specific, not generic AI filler. This is the difference between "neat" and "I would actually use this." Validate on 10 real goals.
- **Guardrails.** Handle vague, tiny, or out-of-scope goals gracefully (the planner should ask for or assume a sensible scope rather than emit junk).
- **Cost and limits.** Surface that each mission spends AI credits; add a per-user or per-day cap so a public URL cannot be drained. Show a friendly message on quota/429.
- **Shareable artifacts.** A public, read-only mission/artifact permalink so a user can share the result.
- **Responsive.** The overlay must be usable on a laptop at minimum; verify it does not break on smaller screens, or gate to desktop with a clear message.

### Phase 4 — Reliability and deploy hardening
- **No stranded missions.** Verify the cron sweep plus in-isolate termination actually prevents hangs under dropped dispatches and 429 storms. Add a timestamp + staleness reaper if Phase 1 shows dispatches dropping.
- **Observability.** Use InsForge function logs to confirm error rates; add a minimal failure breadcrumb so we can see when real missions fail and why.
- **Idempotency under the cron.** Re-running the sweep must never double-dispatch or double-charge AI calls (the atomic claims should hold; verify live).
- **Backups / data hygiene.** Decide retention for `events` and `memories` (they grow per mission).

## 4. What blocks on you
- The InsForge login and project link (Phase 0). I cannot authenticate your account.
- A decision on auth: required to use it, or anonymous-allowed with optional sign-in for history.
- A decision on the public-URL cost cap (how much AI spend you are willing to expose).

## 5. Definition of done (the bar for "real")
- A signed-in user, on the hosted URL, types their own goal and receives a genuinely useful, readable, downloadable artifact produced by real agents, with the live scene reflecting real events.
- They can find that artifact again tomorrow.
- A stranger can do the same without help, without it breaking, and without draining the account.
- Failures are visible and graceful, not silent hangs.

Until Phase 1 exits, everything the user sees is a simulation. That is the next thing to close.
