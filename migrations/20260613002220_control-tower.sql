-- HIVE control tower: governance, steering, observability.
--
-- Adds three subsystems on top of the existing engine, all expressed as plain
-- table state so the orchestrator stays a stateless, idempotent tick:
--   A. Gate engine   -- per-mission budget, step cap, and a per-task risk gate.
--   B. Steering plane -- an interventions queue the browser inserts and the
--                        orchestrator drains (pause, resume, raise budget, kill,
--                        approve/deny a gate, inject a constraint).
--   C. Causal inspector -- cost per task plus running mission totals, so the UI
--                        can show why a node ran and what it cost.
--
-- Idempotent where possible (add column if not exists, drop/recreate the status
-- checks). No BEGIN/COMMIT/ROLLBACK (the CLI wraps each file in a transaction
-- and rejects explicit transaction control). snake_case columns; event payloads
-- mirror these in camelCase, matching the existing posture.

-- missions: governance fields and two new statuses ------------------------
alter table public.missions add column if not exists budget_cents int;
alter table public.missions add column if not exists spent_cents int not null default 0;
alter table public.missions add column if not exists step_count int not null default 0;
alter table public.missions add column if not exists max_steps int;
alter table public.missions add column if not exists guidance text;  -- injected constraints, appended

-- widen the status check to include 'paused' and 'awaiting_input'
alter table public.missions drop constraint if exists missions_status_check;
alter table public.missions add constraint missions_status_check
  check (status in ('planning','running','assembling','complete','failed','paused','awaiting_input'));

-- tasks: cost, risk gate, risk approval, and a 'killed' status -------------
alter table public.tasks add column if not exists cost_cents int not null default 0;
alter table public.tasks add column if not exists risk boolean not null default false;
alter table public.tasks add column if not exists risk_approved boolean not null default false;
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('pending','running','review','rejected','accepted','failed','killed'));

-- interventions: the steering control plane -------------------------------
create table if not exists public.interventions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  type text not null check (type in
    ('pause','resume','raise_budget','kill_task','approve_gate','deny_gate','inject')),
  payload jsonb not null default '{}',
  applied boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists interventions_pending
  on public.interventions(mission_id) where applied = false;

-- RLS: owner (and anon for the demo) may INSERT and SELECT interventions for
-- their mission; edge functions use the admin client and bypass RLS for the
-- applied-flag update. Mirror the posture in the existing rls_grants migration:
-- the browser can request steering and read it back, but only the admin client
-- (service role, in the orchestrator) ever flips applied = true.
alter table public.interventions enable row level security;

drop policy if exists interventions_insert_any on public.interventions;
create policy interventions_insert_any on public.interventions
  for insert to anon, authenticated with check (true);

drop policy if exists interventions_select_any on public.interventions;
create policy interventions_select_any on public.interventions
  for select to anon, authenticated using (true);

grant select, insert on public.interventions to anon, authenticated;
