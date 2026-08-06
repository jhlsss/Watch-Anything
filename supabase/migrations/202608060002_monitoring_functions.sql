alter table public.radars
  add column if not exists tavily_baseline_completed_at timestamptz;

alter table public.findings
  add column if not exists first_seen_during_baseline boolean not null default false;

create table if not exists public.radar_sources (
  id uuid primary key default gen_random_uuid(),
  radar_id uuid not null references public.radars (id) on delete cascade,
  source_key text not null check (source_key in ('music_news_rss')),
  canonical_url text not null,
  baseline_completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint radar_sources_radar_id_source_key_key unique (radar_id, source_key)
);

create table if not exists public.run_findings (
  run_id uuid not null references public.radar_runs (id) on delete cascade,
  finding_id uuid not null references public.findings (id) on delete cascade,
  relevant boolean not null default false,
  relevance_score integer not null default 0 check (relevance_score between 0 and 100),
  confidence numeric(4, 3) not null default 0 check (confidence between 0 and 1),
  importance_score integer not null default 0 check (importance_score between 0 and 100),
  decision text not null default 'evaluation_failed',
  explanation text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (run_id, finding_id)
);

create index if not exists radar_sources_radar_id_idx
  on public.radar_sources (radar_id);

create index if not exists run_findings_finding_id_idx
  on public.run_findings (finding_id);

drop trigger if exists radar_sources_set_updated_at on public.radar_sources;
create trigger radar_sources_set_updated_at
before update on public.radar_sources
for each row
execute function public.set_updated_at();

alter table public.radar_sources enable row level security;
alter table public.run_findings enable row level security;

grant all on public.radar_sources to service_role;
grant all on public.run_findings to service_role;

create or replace function public.create_radar_from_setup(
  p_setup_id uuid,
  p_user_id uuid
)
returns public.radars
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  setup_row public.pending_radar_setups%rowtype;
  radar_row public.radars%rowtype;
  profile_id uuid;
  active_count integer;
begin
  select p.id
    into profile_id
    from public.profiles p
   where p.id = p_user_id
   for update;

  if profile_id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  select s.*
    into setup_row
    from public.pending_radar_setups s
   where s.id = p_setup_id
     and s.user_id = p_user_id
   for update;

  if not found or setup_row.status <> 'pending' or setup_row.expires_at <= now() then
    raise exception 'SETUP_NOT_AVAILABLE';
  end if;

  if not exists (
    select 1
      from public.telegram_connections tc
     where tc.user_id = p_user_id
  ) then
    raise exception 'TELEGRAM_NOT_CONNECTED';
  end if;

  select count(*)
    into active_count
    from public.radars r
   where r.user_id = p_user_id
     and r.status = 'active';

  if active_count >= 3 then
    raise exception 'ACTIVE_RADAR_LIMIT_REACHED';
  end if;

  insert into public.radars (
    user_id,
    name,
    original_prompt,
    rules,
    source_state,
    status,
    interval_minutes,
    baseline_cutoff_at,
    next_check_at
  )
  values (
    p_user_id,
    setup_row.radar_name,
    setup_row.original_prompt,
    setup_row.rules,
    jsonb_build_object(
      'tavily', jsonb_build_object('baselineCompletedAt', null),
      'music_news_rss', jsonb_build_object('baselineCompletedAt', null)
    ),
    'active',
    360,
    now(),
    now()
  )
  returning * into radar_row;

  insert into public.radar_sources (radar_id, source_key, canonical_url)
  values (
    radar_row.id,
    'music_news_rss',
    'https://www.music-news.com/rss/c5RAS2tkYoRTvbRq/UK/news'
  );

  update public.pending_radar_setups
     set status = 'consumed',
         updated_at = timezone('utc', now())
   where id = p_setup_id;

  return radar_row;
end;
$$;

create or replace function public.set_radar_status(
  p_radar_id uuid,
  p_user_id uuid,
  p_next_status text
)
returns table (
  radar_id uuid,
  status text,
  error_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  radar_row public.radars%rowtype;
  active_count integer;
begin
  if p_next_status not in ('active', 'paused') then
    return query select p_radar_id, null::text, 'INVALID_RADAR_STATUS';
    return;
  end if;

  select r.*
    into radar_row
    from public.radars r
   where r.id = p_radar_id
     and r.user_id = p_user_id
   for update;

  if not found then
    return query select p_radar_id, null::text, 'RADAR_NOT_FOUND';
    return;
  end if;

  if radar_row.status = p_next_status then
    return query select radar_row.id, radar_row.status, null::text;
    return;
  end if;

  if p_next_status = 'active' then
    perform 1
      from public.profiles p
     where p.id = p_user_id
     for update;

    select count(*)
      into active_count
      from public.radars r
     where r.user_id = p_user_id
       and r.status = 'active'
       and r.id <> p_radar_id;

    if active_count >= 3 then
      return query select radar_row.id, radar_row.status, 'ACTIVE_RADAR_LIMIT_REACHED';
      return;
    end if;
  end if;

  update public.radars
     set status = p_next_status,
         next_check_at = case
           when p_next_status = 'active' then now()
           else next_check_at
         end,
         updated_at = timezone('utc', now())
   where id = p_radar_id
  returning id, radars.status into radar_id, status;

  return query select radar_id, status, null::text;
end;
$$;

create or replace function public.claim_radar_run(
  p_radar_id uuid,
  p_user_id uuid,
  p_trigger text,
  p_lease_owner uuid,
  p_lease_expires_at timestamptz
)
returns table (
  run_id uuid,
  lease_owner uuid,
  error_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  radar_row public.radars%rowtype;
  claimed_run_id uuid;
  manual_count integer;
begin
  if p_trigger not in ('baseline', 'manual', 'schedule') then
    return query select null::uuid, null::uuid, 'INVALID_RUN_TRIGGER';
    return;
  end if;

  if p_lease_expires_at <= now() then
    return query select null::uuid, null::uuid, 'INVALID_RUN_LEASE';
    return;
  end if;

  select r.*
    into radar_row
    from public.radars r
   where r.id = p_radar_id
     and r.user_id = p_user_id
   for update;

  if not found then
    return query select null::uuid, null::uuid, 'RADAR_NOT_FOUND';
    return;
  end if;

  if radar_row.status <> 'active' then
    return query select null::uuid, null::uuid, 'RADAR_NOT_ACTIVE';
    return;
  end if;

  if radar_row.lease_expires_at is not null
     and radar_row.lease_expires_at > now() then
    return query select null::uuid, null::uuid, 'RADAR_ALREADY_LEASED';
    return;
  end if;

  if p_trigger = 'schedule' and radar_row.next_check_at > now() then
    return query select null::uuid, null::uuid, 'RADAR_NOT_DUE';
    return;
  end if;

  if p_trigger = 'manual' then
    perform 1
      from public.profiles p
     where p.id = p_user_id
     for update;

    if exists (
      select 1
        from public.radar_runs rr
       where rr.radar_id = p_radar_id
         and rr.trigger = 'manual'
         and rr.started_at > now() - interval '30 minutes'
    ) then
      return query select null::uuid, null::uuid, 'MANUAL_CHECK_COOLDOWN';
      return;
    end if;

    select count(*)
      into manual_count
      from public.radar_runs rr
      join public.radars r on r.id = rr.radar_id
     where r.user_id = p_user_id
       and rr.trigger = 'manual'
       and rr.started_at >= date_trunc('day', now());

    if manual_count >= 3 then
      return query select null::uuid, null::uuid, 'MANUAL_DAILY_LIMIT_REACHED';
      return;
    end if;
  end if;

  update public.radars
     set lease_owner = p_lease_owner,
         lease_expires_at = p_lease_expires_at,
         updated_at = timezone('utc', now())
   where id = p_radar_id;

  insert into public.radar_runs (
    radar_id,
    trigger,
    status,
    lease_owner,
    lease_expires_at
  )
  values (
    p_radar_id,
    p_trigger,
    'running',
    p_lease_owner,
    p_lease_expires_at
  )
  returning id into claimed_run_id;

  return query select claimed_run_id, p_lease_owner, null::text;
end;
$$;

create or replace function public.claim_notification(
  p_notification_id uuid
)
returns table (
  notification_id uuid,
  finding_id uuid,
  radar_id uuid,
  user_id uuid,
  destination_id text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.notifications n
     set status = 'sending',
         claimed_at = timezone('utc', now())
   where n.id = p_notification_id
     and n.status = 'pending'
  returning n.id, n.finding_id, n.radar_id, n.user_id, n.destination_id;
$$;

revoke all on function public.create_radar_from_setup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_radar_status(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_radar_run(uuid, uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_notification(uuid) from public, anon, authenticated;

grant execute on function public.create_radar_from_setup(uuid, uuid) to service_role;
grant execute on function public.set_radar_status(uuid, uuid, text) to service_role;
grant execute on function public.claim_radar_run(uuid, uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.claim_notification(uuid) to service_role;
