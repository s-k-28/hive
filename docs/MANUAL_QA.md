# HIVE manual QA and live confirmation

This is the by-hand companion to `docs/deploy.md`. Run it in an environment that
can reach InsForge (your own machine or the build environment, not a sandbox that
blocks `*.insforge`). Record only what you actually observe. Do not mark anything
resolved you did not see work. When every box in Part A is checked from real
output, the deploy.md UNVERIFIED items are genuinely resolved, and not before.

How we do this together: run one step, paste me the output, I tell you pass or
fail and the next step, and I update the docs with the real result. Start at the
top of Part A.

---

## Part A: Live confirmation log (resolves the deploy.md UNVERIFIED items)

Each row is one UNVERIFIED item from deploy.md. Run the test, then fill the
"Observed" line and tick the box only if it passed.

### A1. npm: imports work in the InsForge Deno runtime
- Test: `npx @insforge/cli functions deploy orchestrator --file functions/orchestrator.ts` and the same for `agent-run`, then `npx @insforge/cli functions list`.
- Pass when: both show `status: active`, and later (A7) a real mission produces `plan_created` and `task_completed` events (proves the SDK and openai imports also work at runtime, not just deploy).
- If it fails: switch both imports to `https://esm.sh/...` per deploy.md step 4 and redeploy.
- [ ] PASS  Observed: ______________________

### A2. FUNCTIONS_BASE_URL host is correct
- Test: the two curls in deploy.md step 4.
- Pass when: the agent-run curl returns `401 {"ok":false,"error":"unauthorized"}` and the orchestrator curl returns `404 {"ok":false,"error":"mission not found"}`.
- If it fails (connection error or HTML): the host prefix is wrong; copy the real function URL from the dashboard Functions page and reset `FUNCTIONS_BASE_URL`.
- [ ] PASS  Observed: ______________________

### A3. Migration apply path
- Test: `npx @insforge/cli db migrations list` then `... up --all`, then the verify queries in deploy.md step 1 (including the two control_tower checks at the top of deploy.md).
- Pass when: all five migrations show applied; `select count(*) from public.interventions` runs; `missions` has `budget_cents` / `spent_cents` / `step_count`; `realtime.channels` has the `mission:%` row.
- Record which path worked (A = our files, B = scaffold-and-paste).
- [ ] PASS  Path used: ___  Observed: ______________________

### A4. Realtime publish reaches a subscriber
- Test: during the A7 run, open the hosted site to that mission and watch the board update live; or manually insert a row into `public.events` and check `GET $INSFORGE_URL/api/realtime/messages?...`.
- Pass when: the board (or the messages endpoint) shows events arriving in real time without a manual refresh.
- If it fails: enable Realtime in the dashboard, register the `mission:%` channel via REST (deploy.md step 4 note), confirm the subscribe policy.
- [ ] PASS  Observed: ______________________

### A5. pgvector array form is accepted
- Test: in the A7 run, check for `memory_stored` and `memory_recalled` events, and `npx @insforge/cli functions logs agent-run` for any vector cast error.
- Pass when: memory events appear and no cast error in the logs.
- If it fails (cast error): wrap the embedding as a bracketed string `'[' + embedding.join(',') + ']'` in agent-run (the recall RPC arg and the memories insert), redeploy.
- [ ] PASS  Observed: ______________________

### A6. The live chain drives a mission without relying on cron
- Test: do NOT depend on the cron; just the browser kick plus agent-run pings (the normal flow).
- Pass when: a mission reaches `mission_completed` on its own (the cron is belt-and-suspenders only).
- [ ] PASS  Observed: ______________________

### A7. A full mission completes within step time limits
- Test: deploy.md step 6 (create a mission row, kick the orchestrator, poll the four queries over 30 to 90 seconds).
- Pass when: `events.type` reaches `artifact_created` then `mission_completed`; `missions.status = complete` with a non-null `artifact_url`; opening that URL downloads the markdown.
- If a task stays `running` forever: that is the known stuck-mid-AI limitation; capture which task and the agent-run logs and tell me.
- [ ] PASS  Observed: ______________________

When A1 to A7 all pass, paste me the results and I will update deploy.md to mark
those items resolved with the evidence you saw. Until then they stay UNVERIFIED.

---

## Part B: Live QA on the hosted URL (JOB 1)

Open the hosted site in a normal browser with DevTools open (Console tab) so you
can watch for errors. Sign in (or use anonymous if you kept that allowed). Run
each mission below and tick what you see. "Zero errors" means nothing red in the
Console for the whole run.

For each of these five goals, launch it, pick the tight budget preset for at
least one so a budget gate can fire, and watch the board:

1. "Draft a go-to-market plan for a Postgres analytics tool"
2. "Write a competitive brief on AI note-taking apps"
3. "Outline a technical blog post on multi-agent orchestration"
4. "Summarize the case for usage-based pricing"
5. "plan stuff" (deliberately vague, to test graceful handling)

Per mission, confirm:
- [ ] The plan appears as task cards in dependency columns.
- [ ] The cost meter climbs as steps run; the step counter increments.
- [ ] The risk gate pauses the run and the GatePrompt appears.
- [ ] Approve works; the run continues. (On another run, try Deny, Raise budget, Inject a constraint, and Kill a task, and confirm each does what it says.)
- [ ] Clicking a card opens the Inspector with the task output rendered.
- [ ] The mission reaches complete; the artifact opens and downloads.
- [ ] The run appears in history (if signed in) and reopens.
- [ ] Console: zero red errors for the whole run.

Vague-goal check (#5): the planner still produces a sensible small plan, not junk
and not an empty board.

Record per mission: PASS / FAIL and any bug. Capture a screenshot of the
gate-and-steer moment and one of a completed artifact; those are your real
evidence.

---

## Part C: Finish honestly

- Every Part A box checked from real output: tell me and I update deploy.md
  (UNVERIFIED to resolved, with the evidence).
- Any failure: it is a real bug; paste the symptom and the relevant
  `functions logs`, and I will give you the precise fix to apply (or the prompt
  for the coding agent).
- Nothing is "verified live" until it is in this log with an Observed line. That
  is the rule, and it is why this is done by hand.
