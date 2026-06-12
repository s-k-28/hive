-- Row level security and grants for the four public tables.
--
-- Demo posture (documented and intentional):
--   * Anyone (anon or authenticated) may SELECT all four tables, so the browser
--     renders the live event stream without forcing a login.
--   * Anyone may INSERT a mission (anon demo missions are allowed). The
--     WITH CHECK pins user_id to either NULL (anon) or the caller's own uid, so
--     a client cannot forge a mission under another user's id.
--   * tasks / events / memories are written only by the edge functions through
--     the admin (service role) client, which bypasses RLS. The browser is never
--     granted INSERT/UPDATE/DELETE on those, so it can read the swarm but cannot
--     fabricate agent activity.
--
-- The one write policy here is the missions INSERT, which carries WITH CHECK
-- (USING does not apply to a pure INSERT). A WITH CHECK is required so a row
-- cannot be inserted that the inserter could not read back. auth.uid() is
-- wrapped as (SELECT auth.uid()) for planner-friendly performance.

-- Schema usage -------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- missions -----------------------------------------------------------------
alter table public.missions enable row level security;

drop policy if exists missions_select_all on public.missions;
create policy missions_select_all on public.missions
  for select
  to anon, authenticated
  using (true);

drop policy if exists missions_insert_any on public.missions;
create policy missions_insert_any on public.missions
  for insert
  to anon, authenticated
  with check (
    user_id is null
    or user_id = (select auth.uid())
  );

grant select, insert on public.missions to anon, authenticated;

-- tasks --------------------------------------------------------------------
alter table public.tasks enable row level security;

drop policy if exists tasks_select_all on public.tasks;
create policy tasks_select_all on public.tasks
  for select
  to anon, authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policy for browser roles: writes come from the admin
-- client (service role) in the edge functions, which bypasses RLS entirely.
grant select on public.tasks to anon, authenticated;

-- events -------------------------------------------------------------------
alter table public.events enable row level security;

drop policy if exists events_select_all on public.events;
create policy events_select_all on public.events
  for select
  to anon, authenticated
  using (true);

grant select on public.events to anon, authenticated;

-- memories -----------------------------------------------------------------
alter table public.memories enable row level security;

drop policy if exists memories_select_all on public.memories;
create policy memories_select_all on public.memories
  for select
  to anon, authenticated
  using (true);

grant select on public.memories to anon, authenticated;

-- Sequence usage: the admin client owns event inserts, but grant usage on the
-- event sequence to authenticated as a safety net in case a future authed path
-- needs nextval. anon is intentionally not granted sequence usage.
grant usage, select on sequence hive_event_seq to authenticated;
