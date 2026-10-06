begin;

alter table public.cap_revisions
  add column if not exists calculation_kind text not null default 'analysis',
  add column if not exists engine_version text,
  add column if not exists vehicle_title text,
  add column if not exists purchase_ceiling numeric,
  add column if not exists sale_likely numeric,
  add column if not exists sale_fast numeric,
  add column if not exists confidence_pct integer,
  add column if not exists comparables_used integer,
  add column if not exists input_signature text;

create index if not exists cap_revisions_owner_created
  on public.cap_revisions(user_id,created_at desc);

create index if not exists cap_jobs_input_signature_completed
  on public.cap_jobs(user_id,((context->>'input_signature')),updated_at desc)
  where status='completed';

create index if not exists cap_jobs_market_key_completed
  on public.cap_jobs(user_id,((context->>'market_key')),updated_at desc)
  where status='completed';

update public.cap_revisions
set calculation_kind=coalesce(nullif(snapshot->>'calculation_kind',''),'analysis'),
    engine_version=coalesce(engine_version,snapshot->'result'->>'engine_version'),
    vehicle_title=coalesce(
      vehicle_title,
      nullif(btrim(concat_ws(' ',
        snapshot->'result'->'subject'->>'make',
        snapshot->'result'->'subject'->>'model',
        snapshot->'result'->'subject'->>'trim'
      )),'')
    ),
    purchase_ceiling=coalesce(
      purchase_ceiling,
      nullif(snapshot->'result'->'purchase'->>'effectiveCeiling','')::numeric
    ),
    sale_likely=coalesce(
      sale_likely,
      nullif(snapshot->'result'->'market'->>'saleLikely','')::numeric
    ),
    sale_fast=coalesce(
      sale_fast,
      nullif(snapshot->'result'->'market'->>'saleFast','')::numeric
    ),
    confidence_pct=coalesce(
      confidence_pct,
      nullif(snapshot->'result'->'market'->>'confidencePct','')::integer
    ),
    comparables_used=coalesce(
      comparables_used,
      nullif(snapshot->'result'->'market'->>'comparablesUsed','')::integer
    ),
    input_signature=coalesce(input_signature,snapshot->'research'->>'input_signature');

create or replace function public.cap_save_analysis(p_id uuid,p_snapshot jsonb)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  rev uuid;
  c jsonb;
  v_title text;
begin
  if auth.uid() is null then raise exception 'Access denied'; end if;
  perform 1 from public.cap_analyses where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'Analysis not found'; end if;
  if jsonb_typeof(p_snapshot->'result') is distinct from 'object' then raise exception 'Invalid snapshot'; end if;

  v_title:=nullif(btrim(concat_ws(' ',
    p_snapshot->'result'->'subject'->>'make',
    p_snapshot->'result'->'subject'->>'model',
    p_snapshot->'result'->'subject'->>'trim'
  )),'');

  insert into public.cap_revisions(
    analysis_id,snapshot,calculation_kind,engine_version,vehicle_title,
    purchase_ceiling,sale_likely,sale_fast,confidence_pct,comparables_used,input_signature
  ) values(
    p_id,
    p_snapshot,
    coalesce(nullif(p_snapshot->>'calculation_kind',''),'analysis'),
    p_snapshot->'result'->>'engine_version',
    v_title,
    nullif(p_snapshot->'result'->'purchase'->>'effectiveCeiling','')::numeric,
    nullif(p_snapshot->'result'->'market'->>'saleLikely','')::numeric,
    nullif(p_snapshot->'result'->'market'->>'saleFast','')::numeric,
    nullif(p_snapshot->'result'->'market'->>'confidencePct','')::integer,
    nullif(p_snapshot->'result'->'market'->>'comparablesUsed','')::integer,
    p_snapshot->'research'->>'input_signature'
  )
  returning id into rev;

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

commit;
