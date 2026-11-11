-- Existing projects: run this file in Supabase SQL Editor.
-- Fresh projects: run 001_memory.sql, then this file. Existing history is preserved.
begin;
alter table public.turns add column if not exists memory jsonb not null
  default '{"version":1,"entities":[],"facts":[]}'::jsonb;
alter table public.turns add column if not exists trace jsonb not null default '{}'::jsonb;
-- Index complete structured entities and facts as well as the original prose.
-- No model-generated summary replaces the original conversation.
drop index if exists public.turns_search;
alter table public.turns drop column search_document;
alter table public.turns add column search_document tsvector generated always as
  (to_tsvector('english', question || ' ' || coalesce(answer, '') || ' ' || memory::text)) stored;
create index turns_search on public.turns using gin(search_document);
-- RLS, owner scoping, admission locks and function grants from 001 remain in force.
commit;
