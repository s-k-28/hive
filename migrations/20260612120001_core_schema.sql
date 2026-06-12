-- HIVE core schema: extensions, global event sequence, tables, indexes.
-- Idempotent where possible. No BEGIN/COMMIT/ROLLBACK (the CLI wraps each file
-- in a transaction itself and rejects explicit transaction control).
--
-- Tables are the frozen contract shared by the frontend and the edge functions.
-- Field names are snake_case in columns; payloads stored in events.payload use
-- camelCase so the frontend can reconstruct each SwarmEvent as { type, ...payload }.

-- Extensions ---------------------------------------------------------------
create extension if not exists vector;

-- Global, monotonic event sequence. A single global sequence (not per mission)
-- guarantees strictly increasing, unique seq values across every insert, so the
-- frontend dedup (drop seq <= lastSeq) never discards a real event even under
-- concurrent writers. Per mission ordering is preserved because seq is
-- monotonic and we index (mission_id, seq).
create sequence if not exists hive_event_seq;

-- missions -----------------------------------------------------------------
create table if not exists public.missions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,                       -- nullable: anon demo missions allowed
  goal        text not null,
  status      text not null default 'planning'
    check (status in ('planning','running','assembling','complete','failed')),
  artifact_url text,
  created_at  timestamptz not null default now()
);

-- tasks --------------------------------------------------------------------
-- Composite primary key (mission_id, id) so the planner-assigned slug is unique
-- within a mission. depends_on holds sibling slugs in the same mission.
create table if not exists public.tasks (
  mission_id  uuid not null references public.missions(id) on delete cascade,
  id          text not null,
  title       text not null,
  description text not null default '',
  status      text not null default 'pending'
    check (status in ('pending','running','review','rejected','accepted','failed')),
  depends_on  text[] not null default '{}',
  assignee    text,
  result      text,
  feedback    text,
  attempts    int  not null default 0,
  order_index int  not null default 0,
  primary key (mission_id, id)
);

-- events -------------------------------------------------------------------
-- Append only event log. seq is globally monotonic. type is the SwarmEvent
-- type; payload is the rest of that SwarmEvent object (camelCase keys).
create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  seq        bigint not null default nextval('hive_event_seq'),
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_mission_seq_idx
  on public.events (mission_id, seq);

-- memories (pgvector) ------------------------------------------------------
-- 1536 dims matches openai/text-embedding-3-small. A vector column's dimension
-- cannot be altered in place, so this is fixed to the embedding model.
create table if not exists public.memories (
  id         uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  agent      text not null,
  summary    text not null,
  content    text not null,
  embedding  vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists memories_mission_idx
  on public.memories (mission_id);

-- Cosine-distance index for semantic recall. Cheap to keep even at small row
-- counts; recall queries use embedding <=> query_embedding (cosine distance).
create index if not exists memories_embedding_idx
  on public.memories using hnsw (embedding vector_cosine_ops);
