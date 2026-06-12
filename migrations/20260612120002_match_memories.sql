-- Mission-scoped semantic recall over swarm memories.
--
-- Returns the closest memories for one mission by cosine distance. Scoping to
-- p_mission_id keeps each mission's recall isolated (no cross-mission bleed).
-- Called from the worker edge function via the admin client:
--   admin.database.rpc('match_memories', {
--     query_embedding, p_mission_id, match_count
--   })
--
-- SECURITY DEFINER with a pinned search_path: this function reads only
-- public.memories (not an RLS-recursive table), and pinning search_path avoids
-- surprises if a caller has a different search_path. Distance is 1 - cosine
-- distance expressed as similarity for readability; ordering uses the raw
-- distance operator so the HNSW index is usable.

create or replace function public.match_memories(
  query_embedding vector(1536),
  p_mission_id    uuid,
  match_count     int default 3
)
returns table (
  id         uuid,
  agent      text,
  summary    text,
  content    text,
  similarity float
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    m.id,
    m.agent,
    m.summary,
    m.content,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.memories m
  where m.mission_id = p_mission_id
    and m.embedding is not null
  order by m.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_memories(vector, uuid, int)
  to anon, authenticated;
