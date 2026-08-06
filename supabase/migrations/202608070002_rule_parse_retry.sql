create or replace function public.release_guest_ai_request(
  p_identity_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_id uuid;
begin
  if p_identity_hash is null or btrim(p_identity_hash) = '' then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('watch-anything:guest-ai:global', 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('watch-anything:guest-ai:identity:' || p_identity_hash, 0)
  );

  delete from public.guest_ai_requests
   where id = (
     select r.id
       from public.guest_ai_requests r
      where r.identity_hash = p_identity_hash
      order by r.created_at desc, r.id desc
      limit 1
   )
  returning id into deleted_id;

  return deleted_id is not null;
end;
$$;

revoke all on function public.release_guest_ai_request(text)
  from public, anon, authenticated;
grant execute on function public.release_guest_ai_request(text)
  to service_role;
