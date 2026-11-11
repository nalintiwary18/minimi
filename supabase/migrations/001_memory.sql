-- Run once in Supabase SQL Editor. This app uses server-only service-role access.
create table public.sessions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null,
  title text not null default 'New conversation', created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create table public.turns (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null,
  session_id uuid not null, request_id uuid not null, question text not null,
  answer text, timezone text not null, created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','complete','error')),
  sources jsonb not null default '[]',
  search_document tsvector generated always as
    (to_tsvector('english', question || ' ' || coalesce(answer, ''))) stored,
  foreign key (session_id, owner_id) references public.sessions(id, owner_id) on delete cascade,
  unique (owner_id, request_id)
);
create index turns_search on public.turns using gin(search_document);
create index turns_owner_date on public.turns(owner_id, created_at desc);
create unique index one_pending_turn on public.turns(session_id) where status = 'pending';
alter table public.sessions enable row level security;
alter table public.turns enable row level security;
-- No public policies: browsers cannot read or write memory directly.
revoke all on public.sessions, public.turns from anon, authenticated;

create or replace function public.recall_turns(p_owner uuid, p_query text, p_start timestamptz default null, p_end timestamptz default null, p_limit int default 16)
returns setof public.turns language sql stable set search_path = public as $$
  select t.* from turns t
  where owner_id = p_owner and status <> 'pending'
    and (p_start is null or created_at >= p_start)
    and (p_end is null or created_at < p_end)
    and (p_start is not null or length(trim(p_query)) = 0 or search_document @@ websearch_to_tsquery('english', p_query))
  order by case when p_start is null then ts_rank_cd(search_document, websearch_to_tsquery('english', p_query)) else 0 end desc,
    created_at desc limit least(greatest(p_limit, 1), 32);
$$;

create or replace function public.begin_turn(p_owner uuid, p_session uuid, p_question text, p_timezone text, p_request uuid)
returns jsonb language plpgsql set search_path = public as $$
declare result turns;
begin
  -- Serialize admission per conversation, including retries on different workers.
  perform pg_advisory_xact_lock(hashtextextended(p_session::text, 0));
  if not exists(select 1 from sessions where id = p_session and owner_id = p_owner) then
    raise exception 'Conversation not found';
  end if;
  select * into result from turns where owner_id = p_owner and request_id = p_request;
  if found then return jsonb_build_object('turn', to_jsonb(result), 'created', false); end if;
  update turns set status = 'error' where session_id = p_session and status = 'pending' and created_at < now() - interval '3 minutes';
  if exists(select 1 from turns where session_id = p_session and status = 'pending') then
    raise exception 'A response is already running';
  end if;
  if (select count(*) from turns where owner_id = p_owner and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Too many requests. Wait a minute';
  end if;
  insert into turns(owner_id, session_id, request_id, question, timezone)
    values(p_owner, p_session, p_request, p_question, p_timezone) returning * into result;
  update sessions set title = left(p_question, 70) where id = p_session and title = 'New conversation';
  return jsonb_build_object('turn', to_jsonb(result), 'created', true);
end;
$$;
revoke all on function public.recall_turns(uuid,text,timestamptz,timestamptz,int) from public, anon, authenticated;
revoke all on function public.begin_turn(uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.recall_turns(uuid,text,timestamptz,timestamptz,int) to service_role;
grant execute on function public.begin_turn(uuid,uuid,text,text,uuid) to service_role;
