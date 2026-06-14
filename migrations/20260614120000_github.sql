-- HIVE GitHub integration: per-user repo connections and repo-scoped missions.
--
-- A mission can be scoped to a GitHub repo (read-only). The swarm reads the repo
-- for context — it never commits in this build. The user's GitHub token is held
-- in `connections` (owner-only via RLS); the orchestrator (admin client) reads
-- it server-side to pull repo context during a mission.
--
-- Idempotent. No BEGIN/COMMIT/ROLLBACK (the CLI wraps each file in a
-- transaction and rejects explicit transaction control). snake_case columns.

-- connections --------------------------------------------------------------
-- One row per (user, provider). access_token is stored at rest; for this
-- read-only build that is an accepted tradeoff (follow-up: encrypt or move to a
-- short-lived GitHub App installation token). Only the owner can read/write
-- their row; the orchestrator's admin client bypasses RLS to read the token.
create table if not exists public.connections (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  provider     text not null,
  access_token text not null,
  login        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists connections_user_idx on public.connections (user_id);

alter table public.connections enable row level security;

-- Owner-only on every verb. WITH CHECK pins inserts/updates to the caller's uid
-- so a client cannot write a connection under another user.
drop policy if exists connections_select_own on public.connections;
create policy connections_select_own on public.connections
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists connections_insert_own on public.connections;
create policy connections_insert_own on public.connections
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists connections_update_own on public.connections;
create policy connections_update_own on public.connections
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists connections_delete_own on public.connections;
create policy connections_delete_own on public.connections
  for delete to authenticated using (user_id = (select auth.uid()));

-- anon is intentionally NOT granted: tokens require a signed-in account.
grant select, insert, update, delete on public.connections to authenticated;

-- missions.repo ------------------------------------------------------------
-- The repo a mission works against, as jsonb { provider, fullName, ref }.
-- Null for repo-less missions (the original launch-plan flow). The browser
-- writes it at insert; RLS on missions already pins ownership.
alter table public.missions add column if not exists repo jsonb;

-- Cached, bounded repo snapshot (file tree + key files) the planner fetches once
-- and every worker reads, so repo context costs one GitHub round trip per
-- mission, not one per step. Written by the orchestrator (admin client).
alter table public.missions add column if not exists repo_context text;
