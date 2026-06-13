# HIVE backend fix: collapse the two edge functions into one

## The finding (from a live deploy)

InsForge edge functions CANNOT invoke other edge functions. Every
function-to-function call returns HTTP 508 "Loop Detected." Confirmed live on the
project: the orchestrator's dispatch to agent-run, and the cron sweep's
orchestrator-to-orchestrator call, both return 508. External callers (the
browser, the cron, curl) CAN call a function. So the orchestrator -> agent-run
dispatch architecture cannot work on InsForge and must be refactored into a
single self-contained function.

## What is already live and working (do NOT redo)

On the linked project (app key nmf6vbv4, us-east):
- All 5 migrations are applied and verified (tables, governance columns, RLS, the
  realtime mission:% channel, the match_memories RPC, pgvector).
- Secrets are set: OPENROUTER_API_KEY, INSFORGE_URL, INSFORGE_API_KEY,
  WORKER_TOKEN, FUNCTIONS_BASE_URL.
- The public "artifacts" bucket exists.
- The cron "hive-tick" hits the orchestrator every minute.
- Both functions are deployed (you will redeploy the merged one over them).
- Verified by direct invocation: the planner generates a real 7-task plan and
  records cost. So the AI gateway, pgvector, the realtime trigger, cost
  accounting, and event emission all work when a role actually runs. The ONLY
  thing broken is one function calling another.

## The fix

Collapse functions/orchestrator.ts and functions/agent-run.ts into ONE function
deployed as the slug "orchestrator" that runs the role logic inline, with no
inter-function calls. The browser already invokes 'orchestrator' and the cron
hits 'orchestrator', so no frontend change is needed.

1. Make functions/orchestrator.ts self-contained. It must contain: the shared
   helpers (corsHeaders, json, admin, emitEvent); the AI helpers from agent-run
   (openai, withRetry, chat, extractJson, firstLine, MODELS, RATES_PER_MTOK,
   DEFAULT_RATE, costCentsFor, recordCost); the role functions runPlanner,
   runWorker, runCritic, runAssembler exactly as in agent-run.ts; consumeInterventions
   exactly as in orchestrator.ts; one TaskRow type with ALL columns
   (mission_id, id, title, description, status, depends_on, assignee, result,
   feedback, attempts, order_index, risk, risk_approved, cost_cents); MissionRow;
   InterventionRow; PlanTask; WORKER_NAMES; ROSTER.

2. Replace every inter-function dispatch in the tick with a direct inline call,
   wrapped so a thrown role error still emits the right failure events:
   - planner   -> await runRole(db, missionId, "planner", null)
   - worker    -> await runRole(db, missionId, "worker", task.id)
   - critic    -> await runRole(db, missionId, "critic", task.id)
   - assembler -> await runRole(db, missionId, "assembler", null)
   where runRole(db, missionId, role, taskId) calls the matching run function in a
   try/catch and, on a thrown error, emits the SAME failure events agent-run's old
   handler did: for worker/critic, set the task failed, emit task_failed, then fail
   the mission and emit mission_failed; for planner/assembler, fail the mission and
   emit mission_failed. Move agent-run's handler catch logic into runRole.
   Remove dispatch() entirely. Remove the x-worker-token check (this is now the
   public entry, called directly by the browser and cron). Remove pingOrchestrator.

3. Fix the cron sweep. The body-less call currently does dispatch("orchestrator",
   {missionId}) per mission, which is a function-to-function call (508). Instead,
   extract the per-mission tick into async function runTick(db, missionId) and have
   the handler call await runTick(db, missionId) for the body's missionId, or loop
   for (const id of nonTerminalIds) await runTick(db, id) when there is no missionId.

4. Keep everything else exactly as is: the bounded loop (MAX_PASSES), the budget /
   step / risk gates, the risk-gate pause, the atomic guarded claims, idempotency,
   and the terminal sweep. The browser kick runs the mission until the risk gate or
   completion; the user's approval re-kicks; the cron continues anything stranded
   by a function timeout.

5. After deploy, delete the now-unused agent-run: npx @insforge/cli functions
   delete agent-run, and remove functions/agent-run.ts from the repo (its logic is
   now in orchestrator.ts).

## Deploy and verify live (project already linked and logged in)

```bash
npx @insforge/cli functions deploy orchestrator --file functions/orchestrator.ts
# create a mission and kick it
npx @insforge/cli db query "insert into public.missions (goal,status,budget_cents,max_steps) values ('Write a go-to-market plan','planning',25,16) returning id;"
curl -sS -X POST https://nmf6vbv4.functions.insforge.app/orchestrator -H 'Content-Type: application/json' -d '{"missionId":"<ID>"}'
npx @insforge/cli db query "select string_agg(type,', ' order by seq) from public.events where mission_id='<ID>';"
# approve the risk gate, then re-kick
npx @insforge/cli db query "insert into public.interventions (mission_id,type,payload) values ('<ID>','approve_gate','{\"taskId\":\"<RISK_TASK_ID>\"}');"
curl -sS -X POST https://nmf6vbv4.functions.insforge.app/orchestrator -H 'Content-Type: application/json' -d '{"missionId":"<ID>"}'
```

Expect: events reach gate_tripped (risk), then after approval reach artifact_created
and mission_completed, with mission.status = complete and a non-null artifact_url.
Watch for a function timeout on long missions; the cron and re-kicks continue any
mission that was cut. For a snappy demo keep the budget tight and the task count
low so each invocation is short.

Then update docs/deploy.md: function-to-function is BLOCKED (508); the backend is
one inline function; mark the inter-function dispatch UNVERIFIED item RESOLVED as
"blocked on InsForge, refactored to a single function."

Constraints: no em-dashes; keep lint, build, and tests green; commit and push to
s-k-28/hive; never commit a secret value.
