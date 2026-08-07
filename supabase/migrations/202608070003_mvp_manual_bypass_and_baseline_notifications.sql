-- Temporary MVP QA policy:
-- 1. Findings that are relevant and meet the Radar importance threshold may
--    notify on the baseline run.
-- 2. Only the two designated QA users bypass manual cooldown/daily limits.
--    Concurrency, ownership, active-state, lease, timeout, and dedupe checks
--    remain enforced by the existing monitoring pipeline.

create table if not exists public.mvp_manual_run_bypass_users (
  user_id uuid primary key,
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.mvp_manual_run_bypass_users (user_id)
values
  ('bf2a2366-47b7-40ba-aed5-04410f787fff'::uuid),
  ('a40b13f7-12d8-4b5a-a7d2-f2b55cc7e6cd'::uuid)
on conflict (user_id) do nothing;

revoke all on table public.mvp_manual_run_bypass_users from public, anon, authenticated;
grant all on table public.mvp_manual_run_bypass_users to service_role;

create or replace function public.claim_radar_run_for_mvp_bypass(
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
  claimed record;
  trigger_updated_id uuid;
begin
  if p_trigger is distinct from 'manual' then
    return query select null::uuid, null::uuid, 'INVALID_RUN_TRIGGER';
    return;
  end if;

  if not exists (
    select 1
      from public.mvp_manual_run_bypass_users u
     where u.user_id = p_user_id
  ) then
    return query select null::uuid, null::uuid, 'MVP_BYPASS_NOT_ALLOWED';
    return;
  end if;

  -- Claim as baseline so the existing claim function skips only manual
  -- cooldown/daily-count checks. The row is relabeled manual immediately
  -- while the radar lock is still held by the same transaction.
  select *
    into claimed
    from public.claim_radar_run(
      p_radar_id,
      p_user_id,
      'baseline',
      p_lease_owner,
      p_lease_expires_at
    );

  if claimed.run_id is null then
    return query select claimed.run_id, claimed.lease_owner, claimed.error_code;
    return;
  end if;

  update public.radar_runs
     set trigger = 'manual'
   where id = claimed.run_id
     and status = 'running'
     and lease_owner = claimed.lease_owner
     and trigger = 'baseline'
  returning id into trigger_updated_id;

  if trigger_updated_id is null then
    return query select null::uuid, null::uuid, 'RUN_NOT_CLAIMED';
    return;
  end if;

  return query select claimed.run_id, claimed.lease_owner, null::text;
end;
$$;

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
  finding_found boolean;
  lease_cas_id uuid;
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
     and rr.lease_expires_at > clock_timestamp()
   for update;

  if not found then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  update public.radar_runs
     set lease_expires_at = lease_expires_at
   where id = p_run_id
     and radar_id = radar_id_for_run
     and status = 'running'
     and lease_owner = p_lease_owner
     and lease_expires_at > clock_timestamp()
  returning id into lease_cas_id;

  if lease_cas_id is null then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  threshold := coalesce((radar_row.rules ->> 'importanceThreshold')::integer, 100);

  select f.*
    into finding_row
    from public.findings f
   where f.radar_id = radar_id_for_run
     and f.fingerprint = p_fingerprint
   for update;
  finding_found := found;

  update public.radar_runs
     set lease_expires_at = lease_expires_at
   where id = p_run_id
     and radar_id = radar_id_for_run
     and status = 'running'
     and lease_owner = p_lease_owner
     and lease_expires_at > clock_timestamp()
  returning id into lease_cas_id;

  if lease_cas_id is null then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  if finding_found then
    first_seen := finding_row.first_seen_during_baseline;
    current_eligible := p_relevant
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
    current_eligible := p_relevant
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

  update public.radar_runs
     set lease_expires_at = lease_expires_at
   where id = p_run_id
     and radar_id = radar_id_for_run
     and status = 'running'
     and lease_owner = p_lease_owner
     and lease_expires_at > clock_timestamp()
  returning id into lease_cas_id;

  if lease_cas_id is null then
    raise exception 'RUN_NOT_CLAIMED';
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

revoke all on function public.claim_radar_run_for_mvp_bypass(uuid, uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.persist_run_finding(uuid, uuid, text, text, text, text, text, timestamptz, text, text, boolean, boolean, integer, numeric, integer, text) from public, anon, authenticated;

grant execute on function public.claim_radar_run_for_mvp_bypass(uuid, uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.persist_run_finding(uuid, uuid, text, text, text, text, text, timestamptz, text, text, boolean, boolean, integer, numeric, integer, text) to service_role;
