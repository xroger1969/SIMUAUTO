-- Comparador Auto Pro — cache de identificação por matrícula portuguesa
-- Applied to Supabase on 2026-10-04.

begin;

create table if not exists public.cap_registration_cache (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  registration text not null,
  data jsonb not null,
  provider text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days'),
  primary key (user_id, registration),
  constraint cap_registration_cache_plate_format
    check (registration ~ '^[A-Z0-9]{6}$'),
  constraint cap_registration_cache_data_object
    check (jsonb_typeof(data) = 'object')
);

alter table public.cap_registration_cache enable row level security;

drop policy if exists cap_registration_cache_owner on public.cap_registration_cache;
create policy cap_registration_cache_owner
on public.cap_registration_cache
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on public.cap_registration_cache from public, anon, authenticated;
grant select, insert, update, delete on public.cap_registration_cache to authenticated;

create index if not exists cap_registration_cache_expiry_idx
  on public.cap_registration_cache(user_id, expires_at);

commit;
