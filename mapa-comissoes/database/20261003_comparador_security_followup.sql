-- Comparator RLS/performance follow-up and legacy lead-table lockdown.
-- Applied to Supabase on 2026-10-03.

begin;

create index if not exists cap_jobs_analysis_idx on public.cap_jobs(analysis_id);
create index if not exists cap_revisions_user_idx on public.cap_revisions(user_id);
create index if not exists cap_memory_rules_analysis_idx on public.cap_memory_rules(analysis_id);
create index if not exists cap_outcomes_analysis_idx on public.cap_outcomes(analysis_id);

drop policy if exists cap_analyses_own_rows on public.cap_analyses;
create policy cap_analyses_own_rows on public.cap_analyses for all to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

drop policy if exists cap_comparables_own_rows on public.cap_comparables;
create policy cap_comparables_own_rows on public.cap_comparables for all to authenticated
using(user_id=(select auth.uid()))
with check(user_id=(select auth.uid()) and exists(
  select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=(select auth.uid())
));

drop policy if exists cap_messages_own_rows on public.cap_messages;
create policy cap_messages_own_rows on public.cap_messages for all to authenticated
using(user_id=(select auth.uid()))
with check(user_id=(select auth.uid()) and (
  analysis_id is null or exists(select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=(select auth.uid()))
));

drop policy if exists cap_jobs_owner on public.cap_jobs;
create policy cap_jobs_owner on public.cap_jobs for all to authenticated
using(user_id=(select auth.uid()))
with check(user_id=(select auth.uid()) and exists(
  select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=(select auth.uid())
));

drop policy if exists cap_revisions_owner on public.cap_revisions;
create policy cap_revisions_owner on public.cap_revisions for all to authenticated
using(user_id=(select auth.uid()))
with check(user_id=(select auth.uid()) and exists(
  select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=(select auth.uid())
));

drop policy if exists cap_preferences_owner on public.cap_preferences;
create policy cap_preferences_owner on public.cap_preferences for all to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

drop policy if exists cap_memory_rules_own_rows on public.cap_memory_rules;
create policy cap_memory_rules_own_rows on public.cap_memory_rules for all to authenticated
using(user_id=(select auth.uid()))
with check(user_id=(select auth.uid()) and (
  analysis_id is null or exists(select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=(select auth.uid()))
));

drop policy if exists cap_outcomes_own_rows on public.cap_outcomes;
create policy cap_outcomes_own_rows on public.cap_outcomes for all to authenticated
using(user_id=(select auth.uid()))
with check(user_id=(select auth.uid()) and (
  analysis_id is null or exists(select 1 from public.cap_analyses a where a.id=analysis_id and a.user_id=(select auth.uid()))
));

alter table public.avaliacoes enable row level security;
drop policy if exists avaliacoes_public_insert on public.avaliacoes;
create policy avaliacoes_public_insert on public.avaliacoes for insert to anon,authenticated with check(true);
drop policy if exists avaliacoes_authenticated_read on public.avaliacoes;
create policy avaliacoes_authenticated_read on public.avaliacoes for select to authenticated using(true);
drop policy if exists avaliacoes_authenticated_update on public.avaliacoes;
create policy avaliacoes_authenticated_update on public.avaliacoes for update to authenticated using(true) with check(true);
drop policy if exists avaliacoes_authenticated_delete on public.avaliacoes;
create policy avaliacoes_authenticated_delete on public.avaliacoes for delete to authenticated using(true);

revoke all on public.avaliacoes from public,anon,authenticated;
grant insert on public.avaliacoes to anon,authenticated;
grant select,update,delete on public.avaliacoes to authenticated;
revoke all on sequence public.avaliacoes_id_seq from public,anon,authenticated;
grant usage,select on sequence public.avaliacoes_id_seq to anon,authenticated;

commit;
