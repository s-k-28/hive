# InsForge Integration Cheat Sheet (Hackathon Recon, 2026-06-12)

Sources: docs.insforge.dev markdown pages, github.com/InsForge/insforge-skills (official agent skills), npm @insforge/cli.
Everything quoted is verbatim from docs unless marked ADAPTED (derived from a documented example) or UNVERIFIED (not found in docs, best inference).
Swarm app mapping: Postgres = missions/tasks/events, edge functions = orchestrator + workers, OpenRouter gateway = chat + embeddings, pgvector = memories, realtime = event stream to browser, storage = artifacts, sites = Vite frontend, auth = mission gating.

## 0. Project bootstrap (CLI)

```bash
npx @insforge/cli login
npx @insforge/cli link --project-id <your-project-id>   # project id from https://insforge.dev/dashboard/project/<your-project-id>
npx @insforge/cli --help
npx @insforge/cli secrets get ANON_KEY                  # documented way to fetch the anon key
npx @insforge/cli metadata                              # project metadata (--json supported)
npx @insforge/cli diagnose --json                       # health/diagnostics
```

Other documented top-level commands: `logout`, `whoami`, `current`, `list`, `create`, `config plan|apply|export`, `db`, `functions`, `storage`, `deployments`, `secrets`, `schedules`, `ai`. Common flags: `--json`, `--yes`/`-y`, `--all`.

## 1. Browser client init

Package: `@insforge/sdk@latest`. Base URL pattern: `https://your-app.insforge.app` (regional form seen in docs: `https://your-project.region.insforge.app`). Anon key format starts with `ik_` (example in docs: `ik_xxx`).

```javascript
import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://your-app.insforge.app',
  anonKey: 'your-anon-key'
});
```

Vite env names used by official docs (set in `.env`): `VITE_INSFORGE_URL`, `VITE_INSFORGE_ANON_KEY`. So in our Vite app:

```javascript
const insforge = createClient({
  baseUrl: import.meta.env.VITE_INSFORGE_URL,
  anonKey: import.meta.env.VITE_INSFORGE_ANON_KEY
});
```

(Form with `import.meta.env` is ADAPTED; docs show `process.env.NEXT_PUBLIC_INSFORGE_URL` / `NEXT_PUBLIC_INSFORGE_ANON_KEY` for Next.js and tell Vite users to use the `VITE_*` names.)

Server-only privileged client (never in browser):

```javascript
const admin = createAdminClient({
  baseUrl: process.env.INSFORGE_URL,
  apiKey: process.env.INSFORGE_API_KEY
})
```

Official rule: "Use the anon key for user-scoped SDK clients, including SSR. For privileged server-only app code that needs admin/service access, use `createAdminClient({ apiKey })`."
SSR/browser-cookie variant exists: `import { createBrowserClient } from '@insforge/sdk/ssr'`; it "reads `insforge_access_token` and auto-refreshes through `/api/auth/refresh`".
SDK modules on the client: `database`, `auth`, `storage`, `functions`, `ai` (deprecated, see section 6), `realtime`, `payments`. All calls return `{ data, error }`.

## 2. Auth

```javascript
// Sign up
const { data, error } = await insforge.auth.signUp({
  email: 'user@example.com',
  password: 'secure_password123',
  name: 'John Doe',
  redirectTo: 'http://localhost:3000/sign-in',
});
// Response includes user details and a requireEmailVerification flag.
// When true, accessToken remains null until email confirmation.

// Sign in
const { data, error } = await insforge.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'secure_password123',
});
// Returns authenticated user with accessToken string and CSRF token.

// Current user (auto-refreshes on browser)
const { data, error } = await insforge.auth.getCurrentUser();

// Sign out
const { error } = await insforge.auth.signOut();

// Email verification (OTP)
const { data, error } = await insforge.auth.verifyEmail({ email: 'user@example.com', otp: '123456' });

// OAuth (manual redirect variant)
const { data } = await insforge.auth.signInWithOAuth('google', {
  redirectTo: 'http://localhost:3000/dashboard',
  skipBrowserRedirect: true,
});
window.location.href = data.url;
```

- JWT: InsForge issues a session JWT on login; the SDK attaches it to database/storage/functions/realtime calls automatically, and RLS reads it (`auth.uid()`).
- Token refresh endpoint exists: `/api/auth/refresh` (used by the SSR browser client); REST reference also lists "refresh access token", "get current session".
- Browser token storage mechanism for the plain `createClient` is UNVERIFIED (SSR client uses an `insforge_access_token` cookie; plain client likely uses localStorage, inference).
- Auth errors carry `statusCode`, `error` code, `message`, and `nextActions`.
- OAuth providers: "First-class support for Google, GitHub, Apple, Microsoft, GitLab, Discord, and more."
- Mission gating: store `user_id uuid references auth.users(id)` on `missions` and enforce with RLS (section 3).

## 3. Database

### 3.1 CRUD from the browser (TS SDK)

```javascript
// Insert (skills guide: "Insert requires array format"; chain .select() to get rows back)
const { data, error } = await insforge.database
  .from('posts')
  .insert([{ title: 'First Post', content: 'Hello everyone!' }])
  .select()

// Select
const { data, error } = await insforge.database.from('posts').select('id, title, content')

// Update
const { data, error } = await insforge.database
  .from('posts')
  .update({ title: 'Updated Title' })
  .eq('id', postId)
  .select()

// Delete
const { error } = await insforge.database.from('posts').delete().eq('id', postId)

// Filters: .eq() .neq() .gt() .gte() .lt() .lte() .like() .ilike() .in() .is()
// Modifiers: .order('created_at', { ascending: false }) .range(0, 9) .limit(n) .single() .maybeSingle()

// Count + pagination
const from = (page - 1) * pageSize
const to = from + pageSize - 1
await insforge.database.from('posts').select('*', { count: 'exact' }).range(from, to)

// RPC (stored function)
const { data, error } = await insforge.database.rpc('get_user_stats', { user_id })
```

Response shape: `{ data: Array<object> | null, error: Error | null, count?: number }`.
Note: the TS SDK reference also shows single-object `.insert({...})`; the official skill says always pass an array. Use the array form, it is valid in both.

### 3.2 From an edge function (service access)

Edge functions are plain Deno handlers; there are no documented auto-injected `INSFORGE_*` env vars for functions (UNVERIFIED whether any exist). The documented pattern is:

- Put credentials in function secrets: `npx @insforge/cli secrets add INSFORGE_URL https://...` and `npx @insforge/cli secrets add INSFORGE_API_KEY <key>` (and `ANON_KEY` if needed), then read with `Deno.env.get('NAME')`.
- Privileged access: `createAdminClient({ baseUrl, apiKey })` with the API key. Admin REST endpoints accept `Authorization: Bearer <jwt-or-api-key>` or `X-API-Key: <ik_api_key>`.
- User-scoped access (RLS enforced as the caller): the functions doc says "For edge functions receiving requests, extract the Authorization header and pass via `edgeFunctionToken` parameter."

```typescript
// ADAPTED composite (every piece documented, exact assembly ours):
import { createClient, createAdminClient } from 'npm:@insforge/sdk';

export default async function (req: Request): Promise<Response> {
  // user-scoped client, caller's RLS applies
  const userToken = req.headers.get('Authorization')?.replace('Bearer ', '');
  const insforge = createClient({
    baseUrl: Deno.env.get('INSFORGE_URL'),
    anonKey: Deno.env.get('ANON_KEY'),
    edgeFunctionToken: userToken,   // param name documented; placement in createClient options UNVERIFIED
  });

  // service-level client, bypasses user scoping
  const admin = createAdminClient({
    baseUrl: Deno.env.get('INSFORGE_URL'),
    apiKey: Deno.env.get('INSFORGE_API_KEY'),
  });

  const { data, error } = await admin.database.from('tasks')
    .insert([{ mission_id: '...', status: 'queued' }]).select();
  return new Response(JSON.stringify({ data, error }), { headers: { 'Content-Type': 'application/json' } });
}
```

The `npm:@insforge/sdk` import specifier is UNVERIFIED (Deno supports npm: specifiers and functions "support standard ESM imports"; an https://esm.sh/@insforge/sdk import is the fallback). Functions triggered by database events run "with a service-role JWT so it can perform privileged follow-up writes."

### 3.3 REST (PostgREST style) for raw fetch from workers

```
Base: https://your-app.insforge.app
Headers: Authorization: Bearer your-jwt-token-or-anon-key
         Content-Type: application/json

GET    /api/database/records/posts?status=eq.published&order=createdAt.desc&limit=10
POST   /api/database/records/posts      -H "Prefer: return=representation" -d '[{"title":"My Post","content":"Hello"}]'   # body MUST be an array
PATCH  /api/database/records/posts?id=eq.{id}  -H "Prefer: return=representation" -d '{"title":"Updated Title"}'
DELETE /api/database/records/posts?status=eq.archived
POST   /api/database/rpc/{functionName}
```

Filters: `eq, neq, gt, gte, lt, lte, like, ilike, in, is` plus `limit, offset, order, select`. Responses include `X-Total-Count` and `Content-Range` (e.g. "0-99/1234"). Engine: PostgreSQL 15 behind PostgREST v12.2.

### 3.4 Migrations (CLI, exact)

"A migration is one SQL file prefixed with a 14-digit UTC timestamp: `<YYYYMMDDHHmmss>_<name>.sql`."

```bash
npx @insforge/cli db migrations new create-employees-table   # scaffold a new file
npx @insforge/cli db migrations up --all                     # apply all pending
npx @insforge/cli db migrations up <version>                 # apply one file
npx @insforge/cli db migrations up --to <version>            # apply through a version
npx @insforge/cli db migrations list
npx @insforge/cli db migrations fetch                        # pull remote history for existing projects
```

Rules: applied "in order inside a transaction, sets `search_path` to `public`, and records history only on success"; "`BEGIN`/`COMMIT`/`ROLLBACK` inside a file are rejected"; "Once applied remotely, never edit a migration in place"; "PostgREST reloads schema metadata automatically." Ad hoc SQL: `npx @insforge/cli db query "SELECT ..."` (runs as `project_admin`).

### 3.5 RLS / permission model

Roles: `anon` (no valid session token), `authenticated` (valid session token), `project_admin` (CLI `db query`, migrations, admin API). Identity helper: `auth.uid()` returns the current user UUID; user FKs should reference `auth.users(id)`. `system.update_updated_at()` is a provided trigger for timestamp columns.

Minimal documented pattern (4 steps: create table, enable RLS, policies, grants):

```sql
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_posts" ON posts
  FOR ALL USING (user_id = auth.uid());

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON posts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON posts TO authenticated;
```

Defaults: docs do not state whether RLS is enabled by default on new tables (UNVERIFIED; the documented workflow always enables it explicitly, and the skill says to "Explicitly revoke broad defaults before granting narrow privileges"). Critical rules from the official skill:
- "Always include both `USING` and `WITH CHECK`" on INSERT/UPDATE policies (missing WITH CHECK "allows inserting rows you can't read back").
- RLS helper functions that query RLS tables must be `SECURITY DEFINER` and pinned with `SET search_path = pg_catalog, public, pg_temp` (else infinite recursion).
- Policies combine with OR; one `USING (true)` defeats the rest.
- Wrap `auth.uid()` as `(SELECT auth.uid())` for performance; index every column referenced in policies.

Debugging: `npx @insforge/cli db policies` (list active policies), `npx @insforge/cli logs postgREST.logs` (denial events), `npx @insforge/cli metadata --json` (JWT/claims config). Failure signatures: RLS read blocks return EMPTY DATA not errors; inserts fail with "new row violates RLS policy" when WITH CHECK is missing/misaligned.

## 4. Realtime

### 4.1 Browser SDK (exact API)

```typescript
await insforge.realtime.connect();                       // connect(): Promise<void>

const response = await insforge.realtime.subscribe('chat:room-1');   // subscribe(channel: string): Promise<SubscribeResponse>
if (response.ok) { console.log(response.presence.members); }

insforge.realtime.on('new_message', (message) => {       // on(event: string, callback)
  console.log(message.text);
});
insforge.realtime.on('presence:join', (message) => {
  console.log('Joined:', message.member.presenceId);
});

await insforge.realtime.publish('chat:room-1', 'new_message', {      // publish(channel, event, payload)
  text: 'Hello',
  sentAt: new Date().toISOString()
});

insforge.realtime.unsubscribe('chat:room-1');
insforge.realtime.disconnect();
```

Auth: "The SDK includes the current auth token when one exists. If there is no signed-in user, it can use the configured anon key." Transport is Socket.IO at the project base URL; raw connection auth object is `{ token: '<user-jwt-or-anon-token>' }` or `{ apiKey: '<ik_api_key>' }`; raw events are `socket.emit('realtime:subscribe', { channel: 'order:123' })` and `socket.emit('realtime:publish', { channel, event, payload })`.

### 4.2 Channel patterns MUST be registered first

"The frontend can only subscribe to channel names that match an enabled backend channel pattern." Create the pattern in a migration (SQL LIKE wildcards):

```sql
INSERT INTO realtime.channels (pattern, description, enabled)
VALUES ('mission:%', 'Per-mission event stream', true);
```

(ADAPTED channel name; documented example used `'order:%'`.) Alternative REST: `POST /api/realtime/channels` with `{"pattern": "order:%", "description": "...", "webhookUrls": [...], "enabled": true}` using bearer or `X-API-Key` auth. Inspect policies: `GET /api/realtime/permissions`.

### 4.3 Trigger that publishes INSERTs to mission:{id}

`realtime.publish(channel_name text, event_name text, payload jsonb)` (3 args, signature shown in docs). Documented trigger pattern, ADAPTED from the orders example to our events table:

```sql
CREATE OR REPLACE FUNCTION public.notify_mission_event()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM realtime.publish(
    'mission:' || NEW.mission_id::text,
    'event_created',
    jsonb_build_object(
      'id', NEW.id,
      'type', NEW.type,
      'payload', NEW.payload,
      'createdAt', NEW.created_at
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER mission_events_realtime
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_mission_event();
```

Rule from docs: "Do not attach developer triggers to `realtime.channels` or `realtime.messages`; publish from triggers on `public` tables."

### 4.4 Channel permissions (subscribe/publish RLS)

Subscribe access = `SELECT` policies on `realtime.channels`. Publish access = `INSERT` policies on `realtime.messages`. "Use `realtime.channel_name()` in subscribe policies because clients subscribe to resolved channels such as `order:123`, while `realtime.channels` stores patterns such as `order:%`." Documented authed example, ADAPTED to missions:

```sql
ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_subscribe_own_missions"
ON realtime.channels
FOR SELECT
TO authenticated
USING (
  pattern = 'mission:%'
  AND EXISTS (
    SELECT 1
    FROM public.missions
    WHERE id = NULLIF(split_part(realtime.channel_name(), ':', 2), '')::uuid
      AND user_id = (SELECT auth.uid())
  )
);
```

Anon subscribe (UNVERIFIED, inference from the standard role model; no anon realtime example in docs):

```sql
CREATE POLICY "anon_subscribe_missions" ON realtime.channels
FOR SELECT TO anon USING (pattern = 'mission:%');
```

Publish policy example shape from docs (on `realtime.messages`, note it uses a plain `channel_name` column there): `channel_name LIKE 'chat:%' AND EXISTS (SELECT 1 FROM public.chat_members WHERE room_id = NULLIF(split_part(channel_name, ':', 2), '')::uuid AND user_id = (SELECT auth.uid()))`. Our browser only listens; publishing happens from the DB trigger, so we only need the subscribe policy plus the trigger.

Message wire fields: `id, eventName, channelId, channelName, payload, senderType, senderId, wsAudienceCount, whAudienceCount, whDeliveredCount, createdAt`. History: `GET /api/realtime/messages?channelId=...&eventName=...&limit=...&offset=...`. Channels also support `webhookUrls` fan-out.

## 5. Edge functions

- Runtime: "Deno-powered serverless TypeScript" on Deno Subhosting. "Standard fetch in, standard Response out." "Standard ESM imports and export default to define your handler."
- Handler signature (exact): `export default async function(req: Request): Promise<Response>`
- Documented hello-world:

```javascript
export default async function(request) {
  const { name = 'World' } = await request.json();
  return new Response(
    JSON.stringify({ message: `Hello, ${name}!` }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
```

- File layout: keep source wherever you like, e.g. `./functions/{slug}.ts`; one file per function deploy.
- Deploy (exact): `npx @insforge/cli functions deploy <slug> --file ./functions/<slug>.ts` (optional `--name`, `--description`). Verify with `npx @insforge/cli functions list`. Functions must have `status: "active"` to be invokable (never invoke drafts). Admin API equivalent: `POST /api/functions` with `{ name, code, slug?, description?, status? }` (bearer JWT).
- Secrets (exact): `npx @insforge/cli secrets add KEY VALUE`, read inside the function with `Deno.env.get('SECRET_NAME')`. Dashboard, CLI, and MCP share the same secret store; "secrets never round-trip through your repo."
- Invoke URL: "Every function is reachable at `https://<project>.insforge.dev/functions/<name>`". REST reference shows `POST /functions/{slug}` on the project domain, `security: []` (the platform does NOT enforce auth on this route; your handler must validate the Authorization header itself). The schedules doc also shows a `https://myapp.functions.insforge.app/cleanup` URL form; treat the exact host as project-specific, copy it from the dashboard.

```bash
curl -X POST https://your-domain/functions/hello-world \
  -H "Content-Type: application/json" \
  -d '{"name":"John","age":30}'
```

- Invoke from browser SDK: `await insforge.functions.invoke('function-slug', { body, headers, method })` (method defaults to POST; returns `{ data, error }`; SDK auto-attaches the user token).

```javascript
const { data, error } = await insforge.functions.invoke('hello-world', { body: { name: 'World' } })
const { data, error } = await insforge.functions.invoke('get-stats', { method: 'GET' })
```

- Function-to-function (orchestrator -> worker): no dedicated API documented; use plain `fetch('https://<project>.insforge.dev/functions/<worker-slug>', { method: 'POST', body: JSON.stringify(task) })` from inside the orchestrator (UNVERIFIED as a named feature, but it is just the public HTTP route above). Pass a shared secret header and check it in the worker since the route is unauthenticated. For long-lived workers/queues docs point to Custom Compute (containers with auto-injected "InsForge project URL, service-role JWT, and S3 storage credentials as environment variables").
- CORS (required, from official skill): "Always handle CORS, include preflight OPTIONS handler and CORS headers in every response."

```typescript
if (req.method === 'OPTIONS') {
  return new Response(null, { status: 204, headers: corsHeaders });
}
```

- Timeout / memory limits: NOT FOUND in docs (UNVERIFIED). Deno Subhosting defaults would apply; keep agent steps short and chain via DB state + schedules instead of one long request.
- DB-event-triggered functions "run with a service-role JWT" automatically.

### 5.1 Cron schedules (exact)

Syntax: "Standard 5-field cron (no seconds)": `*/5 * * * *` every 5 min, `0 * * * *` hourly, `0 0 * * *` daily midnight, `0 9 * * 1` Mondays 9am, `0 0 1 * *` monthly. Sub-minute: "pg_cron interval syntax", e.g. `30 seconds`. "Minimum interval is 1 minute (pg_cron)" for cron form. "Failed runs are logged but not retried, so the function must be idempotent."

```bash
npx @insforge/cli schedules create --name <n> --cron "*/1 * * * *" --url <function-url> --method POST   # optional headers/body params
npx @insforge/cli schedules list
npx @insforge/cli schedules get <id>
npx @insforge/cli schedules update <id>
npx @insforge/cli schedules delete <id>
npx @insforge/cli schedules logs <id> [--limit] [--offset]
```

SQL form (exact from docs):

```sql
select schedules.create_job(
  name       => 'daily-cleanup',
  schedule   => '0 0 * * *',
  url        => 'https://myapp.functions.insforge.app/cleanup',
  headers    => jsonb_build_object('Authorization', 'Bearer ${{secrets.CRON_TOKEN}}')
);
```

`${{secrets.KEY}}` placeholders in headers "are resolved and encrypted with `pgcrypto`" at creation. "Deleting a referenced secret breaks every job using it until you update or disable the schedule."

## 6. AI gateway (chat + embeddings) from an edge function

IMPORTANT: the old `insforge.ai.*` SDK methods and `POST /api/ai/chat/completion`, `/api/ai/embeddings`, `/api/ai/image/generation` are DEPRECATED. Current official guidance: "Use OpenRouter directly for model calls" with an InsForge-managed OpenRouter key.

Setup: run `npx @insforge/cli ai setup` (configures credentials) or copy the key from the dashboard; programmatic fetch: `GET /api/ai/openrouter/api-key` (admin auth, returns `apiKey` and `maskedKey`). Store it as a function secret: `npx @insforge/cli secrets add OPENROUTER_API_KEY <key>`. "Route through your server so the key stays private"; "keep `OPENROUTER_API_KEY` server-side."

Client init (exact from docs):

```typescript
import OpenAI from 'openai';

export const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,   // in Deno edge fn: Deno.env.get('OPENROUTER_API_KEY')
  defaultHeaders: {
    'HTTP-Referer': 'https://your-app.example',
    'X-Title': 'Your App',
  },
});
```

Chat completion (exact):

```typescript
const completion = await openai.chat.completions.create({
  model: 'openai/gpt-4o',
  messages: [
    { role: 'system', content: 'You are a concise assistant.' },
    { role: 'user', content: 'What is the capital of France?' },
  ],
});
// text: completion.choices[0]?.message?.content
// usage: prompt_tokens, completion_tokens, model (actual model used)
```

Streaming (exact):

```typescript
const stream = await openai.chat.completions.create({
  model: 'anthropic/claude-3.5-haiku',
  messages: [{ role: 'user', content: 'Write a short product update.' }],
  stream: true,
});
```

Skill guidance for chat UX: "stream tokens to the browser for UX, buffer the final assistant text on the server, and insert one final `assistant` row when the stream completes."

Embeddings (exact):

```typescript
const response = await openai.embeddings.create({
  model: 'openai/text-embedding-3-small',
  input: 'Your text here',
});
// vector: response.data[0].embedding
```

Model id convention: `provider/model` via OpenRouter catalog. Documented ids: `openai/gpt-4o`, `openai/gpt-4o-mini`, `anthropic/claude-3.5-haiku`, `openai/text-embedding-3-small` (1536 dims), `openai/text-embedding-3-large` (3072), `google/gemini-embedding-001` (3072), `google/gemini-2.5-flash-image`, `google/veo-3.1`. "Query OpenRouter models before implementing" (stale ids are a known footgun): `GET https://openrouter.ai/api/v1/models?output_modalities=all`, or InsForge-normalized catalog `GET /api/ai/models` (admin JWT).
Rate limits: "Each project carries its own rate limit and spend cap. Hit it, and the gateway returns a clean 429." Usage (model, tokens, cost) is logged; see `GET /api/ai/overview`, dashboard, or CLI.
Note: core-concepts also describes an OpenAI-compatible gateway at `https://<project>.insforge.dev/v1` (`/v1/chat/completions`, `/v1/embeddings`, `/v1/models`) using "one InsForge-managed key". The SDK/skills pages standardize on the OpenRouter base URL; if the project gateway URL works it is interchangeable, but the OpenRouter base URL is what every current code sample uses. Treat `https://<project>.insforge.dev/v1` as secondary (header details UNVERIFIED).

## 7. pgvector (agent memories)

Migration SQL (exact from docs):

```sql
create extension if not exists vector;

create table documents (
  id bigserial primary key,
  content text,
  embedding vector(1536)
);
```

Dimension must match the embedding model (1536 for `openai/text-embedding-3-small`). "A vector column's dimension cannot be altered in place."

Insert from an edge function (exact, embedding from section 6):

```typescript
const { data, error } = await insforge.database.from('documents').insert([{
  content,
  embedding: response.data[0].embedding,
}]).select()
```

Cosine similarity search: `<=>` is cosine distance ("L2 (`<->`) and inner product (`<#>`) are also available"):

```sql
select id, content
from documents
order by embedding <=> $1
limit 5;
```

RPC match function (exact from docs):

```sql
create or replace function match_documents(
  query_embedding vector(1536),
  match_count int default 5,
  match_threshold float default 0
)
returns table (id bigint, content text, similarity float)
language sql stable
as $$
  select id, content, 1 - (embedding <=> query_embedding) as similarity
  from documents
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

Call it via SDK:

```typescript
const { data: documents, error: searchError } = await insforge.database.rpc(
  'match_documents',
  { query_embedding: embeddingResponse.data[0].embedding, match_count: 5 }
)
```

Index ("Past ~10k rows, add an HNSW index"):

```sql
create index on documents using hnsw (embedding vector_cosine_ops);
```

RLS interacts normally: "RLS policies work automatically with `SECURITY INVOKER` functions."

## 8. Storage (artifacts)

Create bucket: no CLI syntax documented (a `storage` CLI subcommand exists but its syntax is UNVERIFIED); use dashboard or admin API:

```
POST /api/storage/buckets
Header: x-api-key: <api-key>
Body: { "bucketName": "artifacts", "isPublic": true }   # isPublic optional, default true
# 201: { "message": "Bucket created successfully", "bucketName": "artifacts" }
```

Bucket name: alphanumeric, underscores, hyphens only. Buckets must exist before upload.

SDK (works in browser and in edge functions; in a function use the admin client or forwarded user token):

```javascript
// Upload to a chosen key
const { data, error } = await insforge.storage
  .from('images')
  .upload('posts/post-123/cover.jpg', fileObject)

// Upload with auto-generated key
const { data, error } = await insforge.storage.from('uploads').uploadAuto(fileObject)

// Download
const { data: blob, error } = await insforge.storage.from('images').download(post.image_key)

// Delete (takes the key, not the URL)
const { data, error } = await insforge.storage.from('images').remove(post.image_key)
```

Upload response `data` contains both `url` and `key`; official rule: "Always save both url AND key" (URL for display, key for download/delete). Public URL format observed in docs: `https://your-app.region.insforge.app/api/storage/buckets/images/objects/...`. "Public buckets serve files directly over HTTPS; private buckets require a signed URL or an authenticated request"; SDK and REST can issue presigned upload/download URLs (REST: "get upload strategy direct or presigned url", "confirm presigned upload"). Storage is S3-compatible (S3 access keys + gateway endpoints exist). In Deno edge functions construct `fileObject` as a standard `File`/`Blob` (`new File([bytes], 'name.png', { type: 'image/png' })`, UNVERIFIED but standard Deno API). Storage requests pass through RLS-based access control as well (see skills storage/postgres-rls reference).

## 9. Sites (deploy the Vite frontend)

GOTCHA: you deploy the SOURCE directory, not `dist`. "Deploy the project source directory"; the CLI "automatically excludes `node_modules/`, `.git/`, `.next/`, `dist/`, `build/`"; InsForge "sends the source files to Vercel, where framework detection and project files such as `package.json` and `vercel.json` decide how the app builds." So a prebuilt-dist-only upload is NOT the documented path; ship the Vite project root and let it build.

```bash
npx @insforge/cli deployments env set VITE_INSFORGE_URL https://my-app.us-east.insforge.app
npx @insforge/cli deployments env set VITE_INSFORGE_ANON_KEY ik_xxx
npx @insforge/cli deployments env list
npx @insforge/cli deployments deploy .                 # from the Vite project root
npx @insforge/cli deployments deploy . --env '{"VITE_INSFORGE_URL": "...", "VITE_INSFORGE_ANON_KEY": "..."}'
npx @insforge/cli deployments status <id>              # WAITING -> UPLOADING -> QUEUED -> BUILDING -> READY (or ERROR)
```

Result URL: `https://<appkey>.insforge.site` (custom domains via dashboard). SPA routing: "Include a `vercel.json` with rewrites for client-side routing", i.e.:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

(rewrite JSON body is standard Vercel config, ADAPTED; the docs mandate the file but do not print its contents). "Always verify `npm run build` succeeds locally before deploying."

## 10. Gotchas and limits

- CORS: edge functions get no automatic CORS; every function must answer `OPTIONS` with 204 + headers and attach CORS headers to all responses (section 5). Symptom otherwise: browser invoke fails, curl works.
- Function route is public: `POST /functions/{slug}` has `security: []`. Validate the caller (JWT or shared secret header) inside the handler; do not assume the platform gates it.
- Anon key (`ik_...`) is publishable and ends up in the Vite bundle by design; RLS is the only real guard. Never ship `INSFORGE_API_KEY` (admin) or `OPENROUTER_API_KEY` to the browser.
- RLS blocks reads silently: SELECT under a denying policy returns empty `data`, not an error. Also remember GRANTs: RLS policies without `GRANT USAGE ON SCHEMA public` + table GRANTs to `anon, authenticated` still yield failures. Debug with `npx @insforge/cli db policies` and `npx @insforge/cli logs postgREST.logs`.
- Insert shape: SDK skill says insert takes an array; REST POST body MUST be an array; add `Prefer: return=representation` (REST) or chain `.select()` (SDK) to get rows back.
- Realtime: subscribing to `mission:123` fails unless an enabled row in `realtime.channels` matches (`mission:%`) AND a SELECT policy on `realtime.channels` lets your role through. Use `realtime.channel_name()` in subscribe policies (channels table stores patterns, clients use resolved names). Publish-from-browser additionally needs an INSERT policy on `realtime.messages`. Call `connect()` before `subscribe()`. Anon subscribe needs an explicit `TO anon` policy (UNVERIFIED example in section 4.4).
- Realtime event listeners are global per event name (`on('event', cb)`), payload carries channel info; do not attach triggers to `realtime.*` tables themselves.
- AI: deprecated `/api/ai/*` generation routes still appear in API reference; do not build on them. 429 = per-project rate limit / spend cap. Verify model ids against the live catalog first. Embedding dims must match the vector column or inserts fail.
- Schedules: 5-field cron, min 1 minute; failed runs are NOT retried (make orchestrator ticks idempotent); deleting a secret referenced by a schedule breaks the job.
- Migrations: no BEGIN/COMMIT/ROLLBACK in files; never edit applied migrations; 14-digit timestamp prefix required.
- Database perf: avoid JSONB payloads ~1 MB+ per row (PostgREST memory strain); select specific columns in list views; index policy columns; wrap `auth.uid()` in `(SELECT auth.uid())`.
- Storage: save both `url` and `key`; `remove()` needs the key. Bucket must exist first (no documented CLI create; use API/dashboard).
- Sites: deploying `dist/` alone does not work (dist is excluded); deploy source, set `VITE_*` env vars via `deployments env set` BEFORE deploying, add `vercel.json` rewrites for SPA routes.
- Cold starts: not documented (UNVERIFIED). Functions run on Deno Subhosting (isolates, typically fast); Custom Compute containers are the documented answer for always-on workers.
- Free tier limits, function timeout/memory caps, realtime connection caps: NOT FOUND in fetched docs (UNVERIFIED). Check dashboard plan page; design orchestrator steps to finish in seconds and resume via schedules.
- Official agent skills: install with `npx skills add insforge/insforge-skills` (or `/install-skills insforge/insforge-skills` in Claude Code); provides `insforge` (SDK integration), `insforge-cli` (infra ops), `insforge-debug` (logs/policies/diagnostics), `insforge-integrations` (Auth0/Clerk/Kinde/Stytch/WorkOS JWT + RLS). Worth installing for the hackathon; `insforge-debug` knows `requesting_user_id()` vs `auth.uid()` for third-party auth.

## Swarm wiring summary

1. Migrations: missions/tasks/events tables + RLS (`user_id = (SELECT auth.uid())` policies, grants), `realtime.channels` pattern `mission:%` + subscribe policy, events INSERT trigger calling `realtime.publish('mission:' || NEW.mission_id, 'event_created', ...)`, pgvector `memories` table + `match_documents`-style RPC + hnsw index. Apply: `npx @insforge/cli db migrations up --all`.
2. Secrets: `npx @insforge/cli secrets add OPENROUTER_API_KEY ...`, `INSFORGE_URL`, `INSFORGE_API_KEY`, shared `WORKER_TOKEN`.
3. Functions: `orchestrator.ts`, `agent-worker.ts` with `export default async function(req: Request)`; deploy each via `npx @insforge/cli functions deploy <slug> --file functions/<slug>.ts`; orchestrator writes tasks/events with `createAdminClient`, fans out to workers via fetch to `/functions/agent-worker` with `WORKER_TOKEN` header; workers call OpenRouter chat + embeddings, store memories, upload artifacts to storage, insert events rows (trigger streams them).
4. Schedule heartbeat: `npx @insforge/cli schedules create --name tick --cron "*/1 * * * *" --url https://<project>.insforge.dev/functions/orchestrator --method POST`.
5. Frontend: browser `createClient` + auth signUp/signInWithPassword, `realtime.connect()` then `subscribe('mission:'+id)` and `on('event_created', ...)`, deploy with `deployments env set VITE_*` then `deployments deploy .`.
