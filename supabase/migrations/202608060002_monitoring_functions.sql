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
  stale_run record;
  claimed_run_id uuid;
  claimed_radar_id uuid;
  recovered_run_id uuid;
  recovered_status text;
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

  for stale_run in
    select rr.id,
           rr.lease_owner,
           rr.source_success_count,
           rr.source_outcomes
      from public.radar_runs rr
     where rr.radar_id = p_radar_id
       and rr.status = 'running'
       and rr.lease_expires_at is not null
       and rr.lease_expires_at <= now()
     order by rr.started_at, rr.id
     for update
  loop
    recovered_status := case
      when coalesce(stale_run.source_success_count, 0) >= 1
        or exists (
          select 1
            from jsonb_array_elements(
              coalesce(stale_run.source_outcomes, '[]'::jsonb)
            ) outcome
           where outcome ->> 'success' = 'true'
        )
        then 'success'
      else 'failed'
    end;
    recovered_run_id := null;

    update public.radar_runs
       set status = recovered_status,
           finished_at = timezone('utc', now()),
           lease_owner = null,
           lease_expires_at = null
     where id = stale_run.id
       and status = 'running'
       and lease_owner is not distinct from stale_run.lease_owner
       and lease_expires_at <= now()
     returning id into recovered_run_id;

    if recovered_run_id is not null then
      update public.radars
         set lease_owner = null,
             lease_expires_at = null,
             last_checked_at = timezone('utc', now()),
             next_check_at = case
               when recovered_status = 'failed' then now() + interval '15 minutes'
               else now() + interval '6 hours'
             end,
             updated_at = timezone('utc', now())
       where id = p_radar_id
         and lease_expires_at is not null
         and lease_expires_at <= now();
    end if;
  end loop;

  if exists (
    select 1
      from public.radar_runs rr
     where rr.radar_id = p_radar_id
       and rr.status = 'running'
       and (rr.lease_expires_at is null or rr.lease_expires_at > now())
  ) then
    return query select null::uuid, null::uuid, 'RADAR_ALREADY_LEASED';
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
   where id = p_radar_id
     and (lease_expires_at is null or lease_expires_at <= now())
  returning id into claimed_radar_id;

  if claimed_radar_id is null then
    return query select null::uuid, null::uuid, 'RADAR_ALREADY_LEASED';
    return;
  end if;

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
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notifications n
     set status = 'unknown',
         error_code = 'NOTIFICATION_CLAIM_EXPIRED'
   where n.id = p_notification_id
     and n.status = 'sending'
     and (
       n.claimed_at is null
       or n.claimed_at <= timezone('utc', now()) - interval '5 minutes'
     );

  return query
  update public.notifications n
     set status = 'sending',
         claimed_at = timezone('utc', now())
   where n.id = p_notification_id
     and n.status = 'pending'
  returning n.id, n.finding_id, n.radar_id, n.user_id, n.destination_id;
end;
$$;

revoke all on function public.create_radar_from_setup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_radar_status(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_radar_run(uuid, uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_notification(uuid) from public, anon, authenticated;

grant execute on function public.create_radar_from_setup(uuid, uuid) to service_role;
grant execute on function public.set_radar_status(uuid, uuid, text) to service_role;
grant execute on function public.claim_radar_run(uuid, uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.claim_notification(uuid) to service_role;

alter table public.pending_radar_setups
  add column if not exists rule_token_hash text;

create unique index if not exists pending_radar_setups_pending_user_rule_token_hash_idx
  on public.pending_radar_setups (user_id, rule_token_hash)
  where status = 'pending' and rule_token_hash is not null;

create or replace function public.claim_guest_ai_request(
  p_identity_hash text
)
returns table (
  allowed boolean,
  identity_count integer,
  global_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  utc_day_start timestamptz;
begin
  if p_identity_hash is null or btrim(p_identity_hash) = '' then
    return query select false, 0, 0;
    return;
  end if;

  utc_day_start := date_trunc('day', timezone('utc', now())) at time zone 'utc';

  -- Serialize the global quota before the identity quota to avoid deadlocks
  -- between two callers claiming different identities at the same time.
  perform pg_advisory_xact_lock(
    hashtextextended('watch-anything:guest-ai:global', 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('watch-anything:guest-ai:identity:' || p_identity_hash, 0)
  );

  select count(*)::integer
    into identity_count
    from public.guest_ai_requests r
   where r.identity_hash = p_identity_hash
     and r.created_at >= utc_day_start;

  select count(*)::integer
    into global_count
    from public.guest_ai_requests r
   where r.created_at >= utc_day_start;

  if identity_count >= 3 or global_count >= 20 then
    return query select false, identity_count, global_count;
    return;
  end if;

  insert into public.guest_ai_requests (identity_hash)
  values (p_identity_hash);

  return query select true, identity_count + 1, global_count + 1;
end;
$$;

revoke all on function public.claim_guest_ai_request(text) from public, anon, authenticated;
grant execute on function public.claim_guest_ai_request(text) to service_role;

create or replace function public.persist_run_finding(
  p_run_id uuid,
  p_lease_owner uuid,
  p_source_type text,
  p_source_domain text,
  p_source_url text,
  p_title text,
  p_summary text,
  p_published_at timestamptz,
  p_fingerprint text,
  p_event_key text,
  p_source_was_baselined boolean,
  p_relevant boolean,
  p_relevance_score integer,
  p_confidence numeric,
  p_importance_score integer,
  p_match_reason text
)
returns table (
  finding_id uuid,
  radar_id uuid,
  fingerprint text,
  event_key text,
  importance_score integer,
  first_seen_during_baseline boolean,
  notification_eligible boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  radar_id_for_run uuid;
  radar_row public.radars%rowtype;
  run_row public.radar_runs%rowtype;
  finding_row public.findings%rowtype;
  threshold integer;
  first_seen boolean;
  current_eligible boolean;
begin
  select rr.radar_id
    into radar_id_for_run
    from public.radar_runs rr
   where rr.id = p_run_id;

  if radar_id_for_run is null then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  select r.*
    into radar_row
    from public.radars r
   where r.id = radar_id_for_run
   for update;

  select rr.*
    into run_row
    from public.radar_runs rr
   where rr.id = p_run_id
     and rr.radar_id = radar_id_for_run
     and rr.status = 'running'
     and rr.lease_owner = p_lease_owner
     and rr.lease_expires_at > now()
   for update;

  if not found then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  threshold := coalesce((radar_row.rules ->> 'importanceThreshold')::integer, 100);

  select f.*
    into finding_row
    from public.findings f
   where f.radar_id = radar_id_for_run
     and f.fingerprint = p_fingerprint
   for update;

  if found then
    first_seen := finding_row.first_seen_during_baseline;
    current_eligible := not first_seen
      and p_source_was_baselined
      and p_relevant
      and p_importance_score >= threshold;

    update public.findings
       set last_seen_at = timezone('utc', now()),
           event_key = coalesce(finding_row.event_key, p_event_key),
           relevance_score = p_relevance_score,
           importance_score = p_importance_score,
           match_reason = p_match_reason,
           notification_eligible = finding_row.notification_eligible or current_eligible
     where id = finding_row.id
    returning * into finding_row;
  else
    first_seen := not p_source_was_baselined;
    current_eligible := not first_seen
      and p_relevant
      and p_importance_score >= threshold;

    insert into public.findings (
      radar_id,
      first_run_id,
      source_type,
      source_domain,
      source_url,
      canonical_url,
      fingerprint,
      event_key,
      title,
      summary,
      published_at,
      last_seen_at,
      relevance_score,
      importance_score,
      match_reason,
      notification_eligible,
      first_seen_during_baseline
    )
    values (
      radar_id_for_run,
      p_run_id,
      p_source_type,
      p_source_domain,
      p_source_url,
      p_source_url,
      p_fingerprint,
      p_event_key,
      p_title,
      p_summary,
      p_published_at,
      timezone('utc', now()),
      p_relevance_score,
      p_importance_score,
      p_match_reason,
      current_eligible,
      first_seen
    )
    returning * into finding_row;
  end if;

  insert into public.run_findings (
    run_id,
    finding_id,
    relevant,
    relevance_score,
    confidence,
    importance_score,
    decision,
    explanation
  )
  values (
    p_run_id,
    finding_row.id,
    p_relevant,
    p_relevance_score,
    p_confidence,
    p_importance_score,
    case when p_relevant then 'relevant' else 'not_relevant' end,
    p_match_reason
  )
  on conflict (run_id, finding_id) do update
    set relevant = excluded.relevant,
        relevance_score = excluded.relevance_score,
        confidence = excluded.confidence,
        importance_score = excluded.importance_score,
        decision = excluded.decision,
        explanation = excluded.explanation;

  return query
  select finding_row.id,
         radar_id_for_run,
         finding_row.fingerprint,
         finding_row.event_key,
         finding_row.importance_score,
         finding_row.first_seen_during_baseline,
         finding_row.notification_eligible;
end;
$$;

create or replace function public.create_pending_notification_for_run(
  p_run_id uuid,
  p_lease_owner uuid,
  p_finding_id uuid,
  p_destination_id text
)
returns table (
  notification_id uuid,
  finding_id uuid,
  radar_id uuid,
  user_id uuid,
  destination_id text,
  status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  radar_id_for_run uuid;
  radar_row public.radars%rowtype;
  run_row public.radar_runs%rowtype;
  finding_row public.findings%rowtype;
  notification_row public.notifications%rowtype;
  dedupe_key_value text;
begin
  select rr.radar_id
    into radar_id_for_run
    from public.radar_runs rr
   where rr.id = p_run_id;

  if radar_id_for_run is null then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  select r.*
    into radar_row
    from public.radars r
   where r.id = radar_id_for_run
   for update;

  select rr.*
    into run_row
    from public.radar_runs rr
   where rr.id = p_run_id
     and rr.radar_id = radar_id_for_run
     and rr.status = 'running'
     and rr.lease_owner = p_lease_owner
     and rr.lease_expires_at > now()
   for update;

  if not found then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  select f.*
    into finding_row
    from public.findings f
   where f.id = p_finding_id
     and f.radar_id = radar_id_for_run
   for update;

  if not found then
    raise exception 'FINDING_NOT_FOUND';
  end if;

  dedupe_key_value := coalesce(nullif(btrim(finding_row.event_key), ''), finding_row.fingerprint);

  insert into public.notifications (
    finding_id,
    radar_id,
    user_id,
    destination_id,
    dedupe_key,
    status
  )
  values (
    finding_row.id,
    radar_id_for_run,
    radar_row.user_id,
    p_destination_id,
    dedupe_key_value,
    'pending'
  )
  on conflict do nothing
  returning * into notification_row;

  if not found then
    select n.*
      into notification_row
      from public.notifications n
     where (
       n.finding_id = finding_row.id
       and n.destination_id = p_destination_id
     )
        or (
          n.radar_id = radar_id_for_run
          and n.dedupe_key = dedupe_key_value
          and n.destination_id = p_destination_id
        )
     order by n.id
     limit 1
     for update;
  end if;

  if not found then
    raise exception 'NOTIFICATION_NOT_FOUND';
  end if;

  return query
  select notification_row.id,
         notification_row.finding_id,
         notification_row.radar_id,
         notification_row.user_id,
         notification_row.destination_id,
         notification_row.status;
end;
$$;

create or replace function public.mark_source_baseline_for_run(
  p_run_id uuid,
  p_lease_owner uuid,
  p_source_key text,
  p_completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  radar_id_for_run uuid;
  completed_id uuid;
begin
  select rr.radar_id
    into radar_id_for_run
    from public.radar_runs rr
   where rr.id = p_run_id;

  if radar_id_for_run is null then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  perform 1
    from public.radars r
   where r.id = radar_id_for_run
   for update;

  perform 1
    from public.radar_runs rr
   where rr.id = p_run_id
     and rr.radar_id = radar_id_for_run
     and rr.status = 'running'
     and rr.lease_owner = p_lease_owner
     and rr.lease_expires_at > now()
   for update;

  if not found then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  if p_source_key = 'tavily' then
    update public.radars
       set tavily_baseline_completed_at = p_completed_at,
           updated_at = timezone('utc', now())
     where id = radar_id_for_run
    returning id into completed_id;
  elsif p_source_key = 'music_news_rss' then
    update public.radar_sources
       set baseline_completed_at = p_completed_at,
           last_error = null,
           updated_at = timezone('utc', now())
     where radar_id = radar_id_for_run
       and source_key = 'music_news_rss'
    returning id into completed_id;
  else
    raise exception 'INVALID_SOURCE_KEY';
  end if;

  if completed_id is null then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  return true;
end;
$$;

revoke all on function public.persist_run_finding(uuid, uuid, text, text, text, text, text, timestamptz, text, text, boolean, boolean, integer, numeric, integer, text) from public, anon, authenticated;
revoke all on function public.create_pending_notification_for_run(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mark_source_baseline_for_run(uuid, uuid, text, timestamptz) from public, anon, authenticated;

grant execute on function public.persist_run_finding(uuid, uuid, text, text, text, text, text, timestamptz, text, text, boolean, boolean, integer, numeric, integer, text) to service_role;
grant execute on function public.create_pending_notification_for_run(uuid, uuid, uuid, text) to service_role;
grant execute on function public.mark_source_baseline_for_run(uuid, uuid, text, timestamptz) to service_role;
