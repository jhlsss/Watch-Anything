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

  update public.radar_runs as run_update
     set lease_expires_at = run_update.lease_expires_at
   where run_update.id = p_run_id
     and run_update.radar_id = radar_id_for_run
     and run_update.status = 'running'
     and run_update.lease_owner = p_lease_owner
     and run_update.lease_expires_at > clock_timestamp()
  returning run_update.id into lease_cas_id;

  if lease_cas_id is null then
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

  update public.radar_runs as run_update
     set lease_expires_at = run_update.lease_expires_at
   where run_update.id = p_run_id
     and run_update.radar_id = radar_id_for_run
     and run_update.status = 'running'
     and run_update.lease_owner = p_lease_owner
     and run_update.lease_expires_at > clock_timestamp()
  returning run_update.id into lease_cas_id;

  if lease_cas_id is null then
    raise exception 'RUN_NOT_CLAIMED';
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

  if notification_row.status = 'failed' then
    update public.radar_runs as run_update
       set lease_expires_at = run_update.lease_expires_at
     where run_update.id = p_run_id
       and run_update.radar_id = radar_id_for_run
       and run_update.status = 'running'
       and run_update.lease_owner = p_lease_owner
       and run_update.lease_expires_at > clock_timestamp()
    returning run_update.id into lease_cas_id;

    if lease_cas_id is null then
      raise exception 'RUN_NOT_CLAIMED';
    end if;

    update public.notifications n
       set status = 'pending',
           error_code = null,
           claimed_at = null
     where n.id = notification_row.id
       and n.status = 'failed'
    returning * into notification_row;

    if not found then
      raise exception 'NOTIFICATION_NOT_FOUND';
    end if;
  end if;

  if notification_row.status = 'sending'
     and (
       notification_row.claimed_at is null
       or notification_row.claimed_at <= clock_timestamp() - interval '5 minutes'
     ) then
    update public.radar_runs as run_update
       set lease_expires_at = run_update.lease_expires_at
     where run_update.id = p_run_id
       and run_update.radar_id = radar_id_for_run
       and run_update.status = 'running'
       and run_update.lease_owner = p_lease_owner
       and run_update.lease_expires_at > clock_timestamp()
    returning run_update.id into lease_cas_id;

    if lease_cas_id is null then
      raise exception 'RUN_NOT_CLAIMED';
    end if;

    update public.notifications n
       set status = 'unknown',
           error_code = 'NOTIFICATION_CLAIM_EXPIRED'
     where n.id = notification_row.id
       and n.status = 'sending'
       and (
         n.claimed_at is null
         or n.claimed_at <= clock_timestamp() - interval '5 minutes'
       )
    returning * into notification_row;

    if not found then
      raise exception 'NOTIFICATION_NOT_FOUND';
    end if;
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

revoke all on function public.create_pending_notification_for_run(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_pending_notification_for_run(uuid, uuid, uuid, text)
  to service_role;
