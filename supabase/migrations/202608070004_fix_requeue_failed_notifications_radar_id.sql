create or replace function public.requeue_failed_notifications_for_run(
  p_run_id uuid,
  p_lease_owner uuid
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
  radar_lock_id uuid;
  run_lock_id uuid;
  lease_cas_id uuid;
begin
  select rr.radar_id
    into radar_id_for_run
    from public.radar_runs rr
   where rr.id = p_run_id;

  if radar_id_for_run is null then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  select r.id
    into radar_lock_id
    from public.radars r
   where r.id = radar_id_for_run
   for update;

  if radar_lock_id is null then
    raise exception 'RUN_NOT_CLAIMED';
  end if;

  select rr.id
    into run_lock_id
    from public.radar_runs rr
   where rr.id = p_run_id
     and rr.radar_id = radar_id_for_run
     and rr.status = 'running'
     and rr.lease_owner = p_lease_owner
     and rr.lease_expires_at > clock_timestamp()
   for update;

  if run_lock_id is null then
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

  return query
  update public.notifications n
     set status = 'pending',
         error_code = null,
         claimed_at = null
   where n.radar_id = radar_id_for_run
     and n.status = 'failed'
     and exists (
       select 1
         from public.radar_runs rr
        where rr.id = p_run_id
          and rr.radar_id = radar_id_for_run
          and rr.status = 'running'
          and rr.lease_owner = p_lease_owner
          and rr.lease_expires_at > clock_timestamp()
     )
  returning n.id, n.finding_id, n.radar_id, n.user_id, n.destination_id, n.status;
end;
$$;

revoke all on function public.requeue_failed_notifications_for_run(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.requeue_failed_notifications_for_run(uuid, uuid)
  to service_role;
