# HIVE deploy runbook

Take the swarm backend live on InsForge. Ordered, copy-pasteable. Run after you
have an InsForge account. Everything here is correct by construction against the
verified cheat sheet (`docs/insforge-cheatsheet.md`); items the docs did not
fully pin down are flagged UNVERIFIED with a fallback.

You cannot test against a live project from the build environment, so this
runbook is the contract for getting it right first try.

Repo layout this runbook assumes:

```
migrations/    20260612120001_core_schema.sql ... 120004_realtime.sql, 20260613002220_control_tower.sql
functions/     orchestrator.ts, agent-run.ts
vercel.json    SPA rewrites
```

The control tower migration (`20260613002220_control_tower.sql`) adds the
governance columns (budget, spend, step count, guidance), the task cost / risk /
risk_approved columns, the `paused` / `awaiting_input` mission statuses, the
`killed` task status, and the `interventions` steering table with its RLS. It is
idempotent and applies in the same `db migrations up --all` pass as the rest.
After applying, verify the steering table and a governance column exist:

```bash
npx @insforge/cli db query "select count(*) from public.interventions;"
npx @insforge/cli db query "select budget_cents, spent_cents, step_count from public.missions limit 1;"
```

To exercise the steering plane end to end on a live run, insert an intervention
and kick the orchestrator (it drains pending interventions at the top of the
tick):

```bash
# pause a running mission
curl -s -X POST "$INSFORGE_URL/api/database/records/interventions" \
  -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '[{"mission_id":"<MID>","type":"pause"}]'
curl -s -X POST "$FUNCTIONS_BASE_URL/orchestrator" \
  -H "Content-Type: application/json" -d "{\"missionId\":\"<MID>\"}"
# the events stream should now carry mission_paused; status is 'paused'.
```

---

## 0. Prerequisites and project link

```bash
npx @insforge/cli login
npx @insforge/cli list                       # find or confirm your project
npx @insforge/cli link --project-id <your-project-id>
npx @insforge/cli current                    # confirm the linked project
```

Capture these from the dashboard / CLI now, you will need them below:

- Project base URL, e.g. `https://<app>.us-east.insforge.app` (this is `INSFORGE_URL` and `VITE_INSFORGE_URL`).
- Anon key (`ik_...`): `npx @insforge/cli secrets get ANON_KEY` (this is `VITE_INSFORGE_ANON_KEY`).
- Admin API key (`ik_...`, project admin) from the dashboard (this is `INSFORGE_API_KEY`). Never ship this to the browser.
- Functions base URL, e.g. `https://<project>.insforge.dev/functions` (this is `FUNCTIONS_BASE_URL`). UNVERIFIED exact host: the cheat sheet shows both `https://<project>.insforge.dev/functions/<name>` and `https://<app>.functions.insforge.app/<name>`. Copy the real one from the dashboard Functions page after the first deploy and set `FUNCTIONS_BASE_URL` to everything up to and including `/functions` (or the host that prefixes the function name). Verify with the curl in step 6.

---

## 1. Apply migrations

The CLI scaffolds migration files with `db migrations new`, which creates an
empty timestamped file in the migrations directory. Two equivalent paths:

Path A, the CLI already reads our `migrations/` directory (files are already
named with the required 14-digit UTC timestamp prefix and ordered
120001..120004):

```bash
npx @insforge/cli db migrations list         # should show our 4 files as pending
npx @insforge/cli db migrations up --all
```

Path B, if the CLI only applies files it scaffolded itself: scaffold four files
and paste our SQL into them in order, then apply.

```bash
npx @insforge/cli db migrations new core-schema      # paste 20260612120001_core_schema.sql
npx @insforge/cli db migrations new match-memories   # paste 20260612120002_match_memories.sql
npx @insforge/cli db migrations new rls-grants       # paste 20260612120003_rls_grants.sql
npx @insforge/cli db migrations new realtime         # paste 20260612120004_realtime.sql
npx @insforge/cli db migrations up --all
```

Apply order matters (extensions and tables first, then the RPC, then RLS, then
realtime). Our numeric prefixes already encode that order. The files contain no
`BEGIN`/`COMMIT`/`ROLLBACK` (the CLI wraps each in its own transaction and
rejects explicit transaction control). They are idempotent (`create ... if not
exists`, `create or replace`, guarded inserts) so re-running is safe.

Verify:

```bash
npx @insforge/cli db migrations list                 # all 4 applied
npx @insforge/cli db policies                         # missions/tasks/events/memories + realtime.channels policies present
npx @insforge/cli db query "select count(*) from public.missions;"
npx @insforge/cli db query "select pattern, enabled from realtime.channels where pattern = 'mission:%';"
```

UNVERIFIED: whether `db migrations up` reads our pre-authored files (Path A) or
only CLI-scaffolded ones (Path B). If Path A reports nothing pending, use Path B.
If realtime schema objects (`realtime.channels`, `realtime.publish`) are not
present on your plan, see step 4 troubleshooting.

---

## 2. Create the artifacts storage bucket

No documented CLI create syntax, so use the admin API (or the dashboard Storage
tab: create a public bucket named `artifacts`).

```bash
curl -X POST "$INSFORGE_URL/api/storage/buckets" \
  -H "x-api-key: $INSFORGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"bucketName":"artifacts","isPublic":true}'
# expect 201 { "message": "Bucket created successfully", "bucketName": "artifacts" }
```

The assembler uploads to key `missions/<missionId>/launch-plan.md` and reads the
returned public `url`. Public bucket means the URL is directly downloadable in
the browser (the UI links it). The bucket MUST exist before any mission reaches
assembly, or the assembler emits `mission_failed`.

---

## 3. Set secrets (function environment)

Secrets are read inside functions with `Deno.env.get('NAME')`. Set every one of
these. The OpenRouter key is set via `ai setup` (recommended) or `secrets add`.

```bash
# AI gateway key (InsForge-managed OpenRouter key). Either:
npx @insforge/cli ai setup
# ...or set it explicitly if you already have the key:
npx @insforge/cli secrets add OPENROUTER_API_KEY <openrouter-key>

# Privileged DB/storage access for the admin client inside functions:
npx @insforge/cli secrets add INSFORGE_URL https://<app>.us-east.insforge.app
npx @insforge/cli secrets add INSFORGE_API_KEY <project-admin-ik_key>

# Internal function-to-function auth (any long random string you choose):
npx @insforge/cli secrets add WORKER_TOKEN "$(openssl rand -hex 24)"

# Base URL the orchestrator and agent-run use to call each other:
npx @insforge/cli secrets add FUNCTIONS_BASE_URL https://<project>.insforge.dev/functions
```

Secret reference (what each is, who reads it):

| Secret | Used by | What it is |
|---|---|---|
| `OPENROUTER_API_KEY` | agent-run | InsForge-managed OpenRouter key for chat + embeddings. Server-side only. |
| `INSFORGE_URL` | orchestrator, agent-run | Project base URL for the admin SDK client (`createAdminClient`). |
| `INSFORGE_API_KEY` | orchestrator, agent-run | Project admin (service role) key; bypasses RLS for table/storage writes. Never in the browser. |
| `WORKER_TOKEN` | orchestrator, agent-run | Shared secret sent as header `x-worker-token` on internal calls and verified by agent-run (the function route is public). |
| `FUNCTIONS_BASE_URL` | orchestrator, agent-run | Prefix for inter-function fetch, e.g. `.../functions`. Calls go to `${FUNCTIONS_BASE_URL}/orchestrator` and `${FUNCTIONS_BASE_URL}/agent-run`. |

Optional model overrides (sensible defaults baked in; set only to change them):

| Secret | Default | Role |
|---|---|---|
| `AI_PLANNER_MODEL` | `openai/gpt-4o` | planner decomposition |
| `AI_WORKER_MODEL` | `anthropic/claude-3.5-haiku` | worker task execution (fast) |
| `AI_CRITIC_MODEL` | `openai/gpt-4o` | critic review |
| `AI_ASSEMBLER_MODEL` | `openai/gpt-4o` | final artifact composition |
| `AI_EMBED_MODEL` | `openai/text-embedding-3-small` | embeddings (1536 dims, must match the `vector(1536)` column) |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter base URL (override only if routing through the project gateway) |
| `DISPATCH_WAIT_MS` | `2500` | ms the caller waits to guarantee an inter-function request is transmitted before it stops waiting for the response |

IMPORTANT: if you change `AI_EMBED_MODEL` to a model with different dimensions,
you must also change `vector(1536)` in `20260612120001_core_schema.sql` and the
`match_memories` signature in `20260612120002_match_memories.sql`. A vector
column's dimension cannot be altered in place. Keep 1536 unless you have a
reason. Verify model ids against the live catalog before changing them
(`GET https://openrouter.ai/api/v1/models`), stale ids are a known footgun.

```bash
npx @insforge/cli secrets get OPENROUTER_API_KEY     # confirm presence (do not paste keys into chat)
```

---

## 4. Deploy the two edge functions

```bash
npx @insforge/cli functions deploy orchestrator --file functions/orchestrator.ts
npx @insforge/cli functions deploy agent-run    --file functions/agent-run.ts
npx @insforge/cli functions list                     # both must show status: active
```

Notes and UNVERIFIED items:

- Slugs are `orchestrator` and `agent-run`. The orchestrator calls
  `${FUNCTIONS_BASE_URL}/agent-run` and agent-run calls
  `${FUNCTIONS_BASE_URL}/orchestrator`, so the deployed slugs must match exactly.
- Both import `npm:@insforge/sdk`; agent-run also imports `npm:openai`. The
  cheat sheet marks the `npm:` specifier UNVERIFIED on InsForge's Deno runtime.
  Fallback: if a deploy or runtime import fails on the `npm:` specifier, change
  the imports at the top of each file to esm.sh:
  - `import { createAdminClient } from "https://esm.sh/@insforge/sdk";`
  - `import OpenAI from "https://esm.sh/openai";`
  (Pin versions if you hit drift, e.g. `https://esm.sh/@insforge/sdk@1.4.0`,
  `https://esm.sh/openai@4`.)
- The function route is public (`security: []`). agent-run enforces
  `x-worker-token`; the orchestrator does not require the token (it is safe to
  call by the browser and cron), it only reads `{ missionId }`. This is
  intentional: the orchestrator only schedules work derivable from table state.
- Function timeout/memory limits are UNVERIFIED. Each tick and each agent step is
  designed to finish in seconds; the cron heartbeat re-derives remaining work, so
  a single dropped step self-heals on the next tick (except a step stuck mid-AI
  with no terminal event, see Known limitations).

Smoke-test the functions route host (confirms `FUNCTIONS_BASE_URL` is right):

```bash
# Unauthorized agent-run call must be rejected (proves auth + correct host):
curl -s -X POST "$FUNCTIONS_BASE_URL/agent-run" \
  -H "Content-Type: application/json" -d '{"role":"planner","missionId":"x"}'
# expect 401 {"ok":false,"error":"unauthorized"}

# Orchestrator with a bogus mission returns 404 (proves it is reachable):
curl -s -X POST "$FUNCTIONS_BASE_URL/orchestrator" \
  -H "Content-Type: application/json" -d '{"missionId":"00000000-0000-0000-0000-000000000000"}'
# expect 404 {"ok":false,"error":"mission not found"}
```

If the realtime objects were missing in step 1 (some plans gate `realtime.*`):
re-run `20260612120004_realtime.sql` after enabling Realtime in the dashboard,
or create the channel via REST:
`POST $INSFORGE_URL/api/realtime/channels` with
`{"pattern":"mission:%","description":"Per-mission swarm event stream","enabled":true}`
and add the subscribe SELECT policy on `realtime.channels`.

---

## 5. Create the cron heartbeat

A 1-minute safety net that advances any mission the event-driven chain dropped.
The function must be idempotent (it is) because failed cron runs are not retried.

```bash
npx @insforge/cli schedules create \
  --name hive-tick \
  --cron "*/1 * * * *" \
  --url "$FUNCTIONS_BASE_URL/orchestrator" \
  --method POST
npx @insforge/cli schedules list
```

UNVERIFIED: whether the scheduler can send a per-mission body. The cron URL hits
the orchestrator with no `missionId`, so a body-less tick returns
`{ ok:false, error:"missionId required" }` and is harmless. The real advancement
happens via the browser's initial call and the agent-run pings, which always
include `missionId`. If you want the heartbeat to actively sweep, deploy a tiny
extra wrapper later that lists non-terminal missions and pings the orchestrator
for each; not required for the demo. The browser-initiated chain plus pings
drive a mission end to end on their own; the cron is belt-and-suspenders.

---

## 6. End-to-end verification (before wiring the site)

Create a mission row directly, kick the orchestrator, and watch the tables fill.

```bash
# 1) create an anon demo mission (user_id null is allowed by RLS)
curl -s -X POST "$INSFORGE_URL/api/database/records/missions" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '[{"goal":"Draft a launch plan for a developer tool"}]'
# copy the returned id as MID

# 2) advance the swarm
curl -s -X POST "$FUNCTIONS_BASE_URL/orchestrator" \
  -H "Content-Type: application/json" -d "{\"missionId\":\"<MID>\"}"

# 3) watch it work (re-run a few times over ~30-60s)
npx @insforge/cli db query "select type, seq from public.events where mission_id='<MID>' order by seq;"
npx @insforge/cli db query "select id, status, assignee, attempts from public.tasks where mission_id='<MID>' order by order_index;"
npx @insforge/cli db query "select status, artifact_url from public.missions where id='<MID>';"
npx @insforge/cli db query "select agent, summary from public.memories where mission_id='<MID>';"
```

Expected progression of `events.type`: `mission_started`, six `agent_spawned`,
`agent_thought` (planner), `plan_created`, then per task `task_claimed` /
`agent_thought` / `task_completed` / `task_reviewed`, interspersed with
`memory_stored` and `memory_recalled`, and finally `artifact_created` +
`mission_completed`. Mission status ends `complete` with a non-null
`artifact_url`. Open that URL in a browser to confirm the markdown downloads.

If it stalls: `npx @insforge/cli functions logs orchestrator` and
`... logs agent-run`; check `postgREST.logs` for RLS denials; confirm secrets and
`FUNCTIONS_BASE_URL`.

---

## 7. Deploy the frontend (site)

Deploy the Vite SOURCE directory (not `dist/`; the CLI excludes `dist/` and lets
Vercel build from `package.json` + `vercel.json`). Set the `VITE_*` env vars
BEFORE deploying.

```bash
npm run build                                # verify the build is green locally first
npx @insforge/cli deployments env set VITE_INSFORGE_URL https://<app>.us-east.insforge.app
npx @insforge/cli deployments env set VITE_INSFORGE_ANON_KEY ik_xxx
npx @insforge/cli deployments env list
npx @insforge/cli deployments deploy .
npx @insforge/cli deployments status <id>    # WAITING -> ... -> READY
```

Result URL: `https://<appkey>.insforge.site`. `vercel.json` provides SPA
rewrites so client routes resolve.

Frontend contract (the frontend team wires this; documented here so both sides
agree):

- Create a mission: `insforge.database.from('missions').insert([{ goal }]).select()`
  (anon allowed; `user_id` set to `auth.uid()` automatically when signed in, or
  null for anon). Take the returned `id`.
- Kick the swarm once: `insforge.functions.invoke('orchestrator', { body: { missionId: id } })`.
- Subscribe to the stream: `await insforge.realtime.connect()` then
  `insforge.realtime.subscribe('mission:' + id)`, and
  `insforge.realtime.on('event_created', (msg) => ...)`.
- Reshape each realtime message into a `SwarmEventRecord` the store expects:
  the wire payload is `{ id, missionId, seq, type, payload, createdAt }`; build
  `record = { id, missionId, seq, createdAt, event: { type, ...payload } }` and
  call `useSwarm.getState().applyEvent(record)`. This matches `src/lib/types.ts`
  and the simulation in `src/state/simulation.ts` exactly.
- Channel name is `mission:<missionId>`, event name is `event_created`. Both are
  fixed by `migrations/20260612120004_realtime.sql`.

---

## Secret and env var index (single source of truth)

Function secrets (set with `npx @insforge/cli secrets add`):
`OPENROUTER_API_KEY`, `INSFORGE_URL`, `INSFORGE_API_KEY`, `WORKER_TOKEN`,
`FUNCTIONS_BASE_URL`, and optionally `AI_PLANNER_MODEL`, `AI_WORKER_MODEL`,
`AI_CRITIC_MODEL`, `AI_ASSEMBLER_MODEL`, `AI_EMBED_MODEL`, `AI_BASE_URL`,
`DISPATCH_WAIT_MS`.

Site env vars (set with `npx @insforge/cli deployments env set`):
`VITE_INSFORGE_URL`, `VITE_INSFORGE_ANON_KEY`.

---

## UNVERIFIED assumptions and fallbacks (deploy-affecting)

1. `npm:@insforge/sdk` / `npm:openai` import specifiers in InsForge Deno.
   Fallback: switch both imports to `https://esm.sh/...` (step 4).
2. `FUNCTIONS_BASE_URL` host shape (`.insforge.dev/functions` vs
   `.functions.insforge.app`). Fallback: copy the real function URL from the
   dashboard and set the prefix accordingly; the step 4 curl confirms it.
3. Migration apply path (CLI reads our files vs only scaffolded files).
   Fallback: Path B paste-in (step 1).
4. Realtime availability on your plan / `realtime.publish` 3-arg signature.
   Fallback: enable Realtime in the dashboard, register the channel via REST,
   confirm the trigger via a manual insert into `public.events` and a
   `GET $INSFORGE_URL/api/realtime/messages?...` check.
5. Passing a JS `number[]` to a `vector(1536)` RPC param and inserting into a
   `vector` column. This is the documented InsForge pgvector pattern; if a cast
   error appears, wrap the embedding as a bracketed string (e.g.
   `'[' + embedding.join(',') + ']'`) before passing/inserting.
6. Cron per-mission body. The heartbeat is body-less and harmless by design;
   the live chain (browser kick + agent-run pings) drives missions to
   completion (step 5).
7. Function timeout/memory caps unknown. Steps are short; the tick self-heals.
   See Known limitations.

---

## Known limitations (honest, demo-acceptable)

- A worker/critic step that dies AFTER claiming but BEFORE emitting any terminal
  event (e.g. the isolate is killed mid-AI call) leaves its task `running` /
  `review` with no recovery, because the frozen `tasks` schema has no
  claimed-at timestamp to detect staleness, and the orchestrator re-dispatches
  only `pending` tasks and `review` tasks. Mitigation in code: every role is
  wrapped in try/catch that emits `task_failed` / `mission_failed` on any thrown
  error, and inter-function dispatch awaits transmission before returning, so the
  realistic failure modes are covered. A full fix (stuck-task reaping) would
  require adding a timestamp column, which is outside the frozen contract.
- The critic converges after at most one retry (one visible bounce-back), by
  design, to guarantee the mission always terminates.
