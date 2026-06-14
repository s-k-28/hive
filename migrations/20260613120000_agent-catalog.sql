-- HIVE specialist-agent catalog: the library of experts the planner draws from.
--
-- Each mission task is matched to the best-fit specialist by semantic similarity
-- over the agent descriptions (same pgvector pattern as swarm memory recall).
-- The worker that claims a task loads its specialist's persona from here and
-- assumes that voice. Catalog rows are reference data: world-readable, written
-- only by the admin client at seed time (scripts/seed-agent-catalog.mjs).
--
-- Idempotent. No BEGIN/COMMIT/ROLLBACK (the CLI wraps each file in a
-- transaction and rejects explicit transaction control). snake_case columns.

-- agents_catalog -----------------------------------------------------------
-- embedding dim 1536 matches openai/text-embedding-3-small, the same model the
-- swarm uses for memory, so one embedding model serves the whole system.
create table if not exists public.agents_catalog (
  slug        text primary key,
  name        text not null,
  division    text not null,
  subdivision text,
  emoji       text not null default '',
  vibe        text not null default '',
  description text not null default '',
  persona     text not null default '',
  tags        text[] not null default '{}',
  embedding   vector(1536),
  created_at  timestamptz not null default now()
);

create index if not exists agents_catalog_division_idx
  on public.agents_catalog (division);

-- Cosine-distance index for specialist selection.
create index if not exists agents_catalog_embedding_idx
  on public.agents_catalog using hnsw (embedding vector_cosine_ops);

-- tasks.specialist ---------------------------------------------------------
-- The chosen expert, denormalized as jsonb { slug, name, emoji, division } so
-- the frontend renders the chip without a join and the worker has the slug to
-- load the full persona. Null until the planner assigns one.
alter table public.tasks add column if not exists specialist jsonb;

-- match_agents -------------------------------------------------------------
-- Return the closest specialists to a task embedding by cosine distance,
-- optionally restricted to a division. Mirrors match_memories: SECURITY DEFINER
-- with a pinned search_path, reads only this reference table, orders by the raw
-- distance operator so the HNSW index is usable. Persona is returned so the
-- worker can pull it in the same round trip.
create or replace function public.match_agents(
  query_embedding vector(1536),
  match_count     int default 5,
  p_division      text default null
)
returns table (
  slug        text,
  name        text,
  division    text,
  emoji       text,
  description text,
  persona     text,
  similarity  float
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    a.slug,
    a.name,
    a.division,
    a.emoji,
    a.description,
    a.persona,
    1 - (a.embedding <=> query_embedding) as similarity
  from public.agents_catalog a
  where a.embedding is not null
    and (p_division is null or a.division = p_division)
  order by a.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_agents(vector, int, text)
  to anon, authenticated;

-- RLS: the catalog is world-readable reference data; only the admin client
-- (service role, used by the seed script and edge function) ever writes it.
alter table public.agents_catalog enable row level security;

drop policy if exists agents_catalog_select_all on public.agents_catalog;
create policy agents_catalog_select_all on public.agents_catalog
  for select
  to anon, authenticated
  using (true);

grant select on public.agents_catalog to anon, authenticated;
