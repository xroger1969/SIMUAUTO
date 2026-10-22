-- A repeated immutable save payload returns its original revision.
-- Preserves SECURITY INVOKER, ownership/RLS, signature, and existing grants.
-- No stored history, policies or table data are rewritten.
begin;

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

  -- Serializing on the owning analysis above makes retries safe even when
  -- two requests arrive together after an acknowledged or lost response.
  -- Compare the full immutable payload: changed assumptions remain revisions.
  select r.id into rev
  from public.cap_revisions r
  where r.analysis_id=p_id and r.user_id=auth.uid() and r.snapshot=p_snapshot
  order by r.created_at desc,r.id desc
  limit 1;
  if found then
    -- An old retry must not replace a newer analysis snapshot.
    return rev;
  end if;

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
