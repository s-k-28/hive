-- Realtime: per-mission channel registration and the publish trigger.
--
-- The frontend subscribes to 'mission:' || missionId and listens for the
-- 'event_created' event. The backend never publishes from the browser; every
-- broadcast originates from this AFTER INSERT trigger on public.events, so the
-- act of an agent writing a row IS the broadcast.
--
-- Wire payload (must match what the frontend reshapes into a SwarmEventRecord):
--   { id, missionId, seq, type, payload, createdAt }
-- The frontend rebuilds record.event = { type, ...payload } from this.

-- 1. Register the channel pattern. The frontend can only subscribe to channel
--    names that match an enabled pattern. Insert idempotently (guard on
--    pattern, since realtime.channels has no contract-guaranteed unique index
--    we can ON CONFLICT against).
do $$
begin
  if not exists (
    select 1 from realtime.channels where pattern = 'mission:%'
  ) then
    insert into realtime.channels (pattern, description, enabled)
    values ('mission:%', 'Per-mission swarm event stream', true);
  end if;
end $$;

-- 2. Subscribe permission. Subscribe access is governed by SELECT policies on
--    realtime.channels. Demo posture: anon and authenticated may both subscribe
--    to any mission channel (the browser streams a mission it just created,
--    possibly while anonymous). Keep it simple: allow the pattern through.
alter table realtime.channels enable row level security;

drop policy if exists hive_subscribe_missions on realtime.channels;
create policy hive_subscribe_missions on realtime.channels
  for select
  to anon, authenticated
  using (pattern = 'mission:%');

-- 3. Publish trigger. SECURITY DEFINER so it can call realtime.publish
--    regardless of the inserting role (the admin client inserts events). Do not
--    attach triggers to realtime.* tables; this lives on public.events.
create or replace function public.notify_mission_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, realtime, pg_temp
as $$
begin
  perform realtime.publish(
    'mission:' || new.mission_id::text,
    'event_created',
    jsonb_build_object(
      'id', new.id,
      'missionId', new.mission_id,
      'seq', new.seq,
      'type', new.type,
      'payload', new.payload,
      'createdAt', new.created_at
    )
  );
  return new;
end;
$$;

drop trigger if exists mission_events_realtime on public.events;
create trigger mission_events_realtime
  after insert on public.events
  for each row
  execute function public.notify_mission_event();
