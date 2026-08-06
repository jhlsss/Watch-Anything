create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  locale text not null default 'en' check (locale in ('en', 'zh-CN')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.guest_ai_requests (
  id uuid primary key default gen_random_uuid(),
  identity_hash text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pending_radar_setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  original_prompt text not null,
  radar_name text not null,
  rules jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'consumed', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.telegram_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  chat_id bigint not null unique,
  telegram_username text,
  connected_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.telegram_binding_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists public.radars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  original_prompt text not null,
  rules jsonb not null,
  source_state jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'paused')),
  interval_minutes integer not null default 360 check (interval_minutes = 360),
  baseline_cutoff_at timestamptz not null,
  last_checked_at timestamptz,
  next_check_at timestamptz not null,
  lease_owner uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.radar_runs (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid not null references public.radars (id) on delete cascade,
  trigger text not null check (trigger in ('baseline', 'schedule', 'manual')),
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  relevant_count integer not null default 0 check (relevant_count >= 0),
  notification_count integer not null default 0 check (notification_count >= 0),
  source_outcomes jsonb not null default '[]'::jsonb,
  source_success_count integer not null default 0 check (source_success_count >= 0),
  lease_owner uuid,
  lease_expires_at timestamptz,
  error_code text,
  internal_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid not null references public.radars (id) on delete cascade,
  first_run_id uuid references public.radar_runs (id) on delete set null,
  source_type text not null check (source_type in ('tavily', 'rss')),
  source_domain text not null,
  source_url text not null,
  canonical_url text,
  fingerprint text not null,
  event_key text,
  title text not null,
  summary text not null,
  published_at timestamptz,
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  relevance_score integer not null default 0 check (relevance_score between 0 and 100),
  importance_score integer not null default 0 check (importance_score between 0 and 100),
  match_reason text not null default '',
  notification_eligible boolean not null default false,
  constraint findings_radar_id_fingerprint_key unique (radar_id, fingerprint)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings (id) on delete cascade,
  radar_id uuid not null references public.radars (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  destination_id text not null,
  dedupe_key text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'unknown')),
  telegram_message_id bigint,
  error_code text,
  claimed_at timestamptz,
  sent_at timestamptz,
  constraint notifications_radar_id_dedupe_key_destination_id_key unique (radar_id, dedupe_key, destination_id),
  constraint notifications_finding_id_destination_id_key unique (finding_id, destination_id)
);

create index if not exists guest_ai_requests_identity_hash_created_at_idx
  on public.guest_ai_requests (identity_hash, created_at desc);

create index if not exists pending_radar_setups_user_id_status_expires_at_idx
  on public.pending_radar_setups (user_id, status, expires_at);

create index if not exists radars_due_idx
  on public.radars (status, next_check_at)
  where status = 'active';

create index if not exists radars_user_id_status_idx
  on public.radars (user_id, status);

create index if not exists radar_runs_radar_id_started_at_idx
  on public.radar_runs (radar_id, started_at desc);

create index if not exists findings_radar_id_last_seen_at_idx
  on public.findings (radar_id, last_seen_at desc);

create index if not exists notifications_user_id_status_idx
  on public.notifications (user_id, status);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists pending_radar_setups_set_updated_at on public.pending_radar_setups;
create trigger pending_radar_setups_set_updated_at
before update on public.pending_radar_setups
for each row
execute function public.set_updated_at();

drop trigger if exists radars_set_updated_at on public.radars;
create trigger radars_set_updated_at
before update on public.radars
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, locale)
  values (new.id, 'en')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.guest_ai_requests enable row level security;
alter table public.pending_radar_setups enable row level security;
alter table public.telegram_connections enable row level security;
alter table public.telegram_binding_tokens enable row level security;
alter table public.radars enable row level security;
alter table public.radar_runs enable row level security;
alter table public.findings enable row level security;
alter table public.notifications enable row level security;

grant select on public.profiles to authenticated;
grant update (locale) on public.profiles to authenticated;
grant select on public.pending_radar_setups to authenticated;
grant select on public.telegram_connections to authenticated;
grant select on public.radars to authenticated;
grant select on public.radar_runs to authenticated;
grant select on public.findings to authenticated;
grant select on public.notifications to authenticated;

grant all on public.profiles to service_role;
grant all on public.guest_ai_requests to service_role;
grant all on public.pending_radar_setups to service_role;
grant all on public.telegram_connections to service_role;
grant all on public.telegram_binding_tokens to service_role;
grant all on public.radars to service_role;
grant all on public.radar_runs to service_role;
grant all on public.findings to service_role;
grant all on public.notifications to service_role;

revoke update on public.profiles from authenticated;
grant update (locale) on public.profiles to authenticated;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy "profiles_update_own_locale"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "pending_radar_setups_select_own"
  on public.pending_radar_setups
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "telegram_connections_select_own"
  on public.telegram_connections
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "radars_select_own"
  on public.radars
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "radar_runs_select_via_radar_owner"
  on public.radar_runs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.radars r
      where r.id = radar_id
        and r.user_id = auth.uid()
    )
  );

create policy "findings_select_via_radar_owner"
  on public.findings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.radars r
      where r.id = radar_id
        and r.user_id = auth.uid()
    )
  );

create policy "notifications_select_own"
  on public.notifications
  for select
  to authenticated
  using (user_id = auth.uid());
