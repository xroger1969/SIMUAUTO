-- Comparador Auto Pro — reliability/audit migration
-- Applied to Supabase on 2026-10-03.

begin;

alter table public.cap_analyses add column if not exists snapshot jsonb not null default '{}'::jsonb;

create table if not exists public.cap_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  analysis_id uuid not null references public.cap_analyses(id) on delete cascade,
  request_key uuid not null,
  response_id text,
  status text not null default 'starting',
  context jsonb not null default '{}'::jsonb,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,request_key)
);
alter table public.cap_jobs enable row level security;

create table if not exists public.cap_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  analysis_id uuid not null references public.cap_analyses(id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.cap_revisions enable row level security;

create table if not exists public.cap_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.cap_preferences enable row level security;

alter table public.cap_comparables
  add column if not exists revision_id uuid references public.cap_revisions(id) on delete cascade;

create index if not exists cap_jobs_owner_created on public.cap_jobs(user_id,created_at desc);
create index if not exists cap_revisions_analysis on public.cap_revisions(analysis_id,created_at desc);
create index if not exists cap_comparables_revision on public.cap_comparables(revision_id);

create table if not exists mapa_comercial_private.cap_quota(
  user_id uuid not null,
  kind text not null,
  window_start timestamptz not null,
  counter integer not null,
  primary key(user_id,kind,window_start)
);
alter table mapa_comercial_private.cap_quota enable row level security;
revoke all on mapa_comercial_private.cap_quota from public,anon,authenticated;

create or replace function public.cap_take_quota(p_kind text)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare lim integer; used integer; uid uuid:=auth.uid(); win timestamptz:=date_trunc('hour',now());
begin
  if uid is null or not mapa_comercial_private.is_admin() then return false; end if;
  lim:=case p_kind when 'market' then 20 when 'reader' then 60 when 'chat' then 40 when 'voice' then 40 else 0 end;
  if lim=0 then return false; end if;
  insert into mapa_comercial_private.cap_quota(user_id,kind,window_start,counter)
  values(uid,p_kind,win,1)
  on conflict(user_id,kind,window_start)
  do update set counter=mapa_comercial_private.cap_quota.counter+1
  returning counter into used;
  delete from mapa_comercial_private.cap_quota where window_start<now()-interval '2 days';
  return used<=lim;
end
$$;
revoke all on function public.cap_take_quota(text) from public,anon,authenticated;
grant execute on function public.cap_take_quota(text) to authenticated;

create or replace function public.cap_claim_job(p_analysis uuid,p_request uuid,p_context jsonb)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare j public.cap_jobs; claimed boolean;
begin
  if auth.uid() is null or not exists(
    select 1 from public.cap_analyses where id=p_analysis and user_id=auth.uid()
  ) then raise exception 'Access denied'; end if;

  insert into public.cap_jobs(analysis_id,request_key,context)
  values(p_analysis,p_request,coalesce(p_context,'{}'::jsonb))
  on conflict(user_id,request_key) do nothing
  returning * into j;

  claimed:=found;
  if not claimed then
    select * into j from public.cap_jobs where user_id=auth.uid() and request_key=p_request;
  end if;
  if j.analysis_id<>p_analysis then raise exception 'Invalid request'; end if;
  return jsonb_build_object('claimed',claimed,'job',to_jsonb(j));
end
$$;
revoke all on function public.cap_claim_job(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cap_claim_job(uuid,uuid,jsonb) to authenticated;

create or replace function public.cap_save_analysis(p_id uuid,p_snapshot jsonb)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare rev uuid; c jsonb;
begin
  if auth.uid() is null then raise exception 'Access denied'; end if;
  perform 1 from public.cap_analyses where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'Analysis not found'; end if;
  if jsonb_typeof(p_snapshot->'result') is distinct from 'object' then raise exception 'Invalid snapshot'; end if;

  insert into public.cap_revisions(analysis_id,snapshot) values(p_id,p_snapshot) returning id into rev;

  update public.cap_analyses
  set status='done',
      vehicle=coalesce(p_snapshot->'result'->'subject','{}'::jsonb),
      market=coalesce(p_snapshot->'result'->'market','{}'::jsonb),
      purchase=coalesce(p_snapshot->'result'->'purchase','{}'::jsonb),
      risks=coalesce(p_snapshot->'research'->'risk_flags','[]'::jsonb),
      reader=coalesce(p_snapshot->'reader','{}'::jsonb),
      source_snapshot=coalesce(p_snapshot->'reader'->'page',source_snapshot),
      source_last_seen_at=now(),
      snapshot=p_snapshot,
      updated_at=now(),
      error_message=null
  where id=p_id;

  for c in select value from jsonb_array_elements(coalesce(p_snapshot->'result'->'comparables','[]'::jsonb))
  loop
    insert into public.cap_comparables(
      analysis_id,revision_id,source_url,source_domain,vehicle,similarity,adjusted_price,used_in_valuation
    ) values(
      p_id,rev,c->>'url',c->>'source_domain',c,
      nullif(c->>'similarity','')::numeric,
      nullif(c->>'adjustedPrice','')::numeric,
      true
    );
  end loop;

  for c in select value from jsonb_array_elements(coalesce(p_snapshot->'result'->'excluded','[]'::jsonb))
  loop
    insert into public.cap_comparables(
      analysis_id,revision_id,source_url,source_domain,vehicle,used_in_valuation,exclusion_reason
    ) values(
      p_id,rev,
      coalesce(c->>'url',c->'comp'->>'url'),
      c->'comp'->>'source_domain',
      coalesce(c->'comp',c),
      false,
      c->>'reason'
    );
  end loop;
  return rev;
end
$$;
revoke all on function public.cap_save_analysis(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cap_save_analysis(uuid,jsonb) to authenticated;

drop policy if exists cap_jobs_owner on public.cap_jobs;
create policy cap_jobs_owner on public.cap_jobs for all to authenticated
using(user_id=auth.uid())
with check(user_id=auth.uid() and exists(
  select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=auth.uid()
));

drop policy if exists cap_revisions_owner on public.cap_revisions;
create policy cap_revisions_owner on public.cap_revisions for all to authenticated
using(user_id=auth.uid())
with check(user_id=auth.uid() and exists(
  select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=auth.uid()
));

drop policy if exists cap_preferences_owner on public.cap_preferences;
create policy cap_preferences_owner on public.cap_preferences for all to authenticated
using(user_id=auth.uid()) with check(user_id=auth.uid());

drop policy if exists cap_memory_rules_own_rows on public.cap_memory_rules;
create policy cap_memory_rules_own_rows on public.cap_memory_rules for all to authenticated
using(user_id=auth.uid())
with check(user_id=auth.uid() and (
  analysis_id is null or exists(select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=auth.uid())
));

drop policy if exists cap_outcomes_own_rows on public.cap_outcomes;
create policy cap_outcomes_own_rows on public.cap_outcomes for all to authenticated
using(user_id=auth.uid())
with check(user_id=auth.uid() and (
  analysis_id is null or exists(select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=auth.uid())
));

revoke all on public.cap_jobs from public,anon,authenticated;
grant select,insert,update on public.cap_jobs to authenticated;
revoke all on public.cap_revisions from public,anon,authenticated;
grant select,insert on public.cap_revisions to authenticated;
revoke all on public.cap_preferences from public,anon,authenticated;
grant select,insert,update on public.cap_preferences to authenticated;

commit;
