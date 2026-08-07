alter table public.pending_radar_setups
  add column if not exists radar_id uuid references public.radars (id) on delete set null;

with consumed_setups as (
  select setup_row.id,
         (
           select r.id
             from public.radars r
            where r.user_id = setup_row.user_id
              and r.name = setup_row.radar_name
              and r.original_prompt = setup_row.original_prompt
              and r.rules = setup_row.rules
              and r.created_at >= setup_row.created_at
            order by r.created_at asc, r.id asc
            limit 1
         ) as radar_id
    from public.pending_radar_setups setup_row
   where setup_row.status = 'consumed'
     and setup_row.radar_id is null
)
update public.pending_radar_setups as setup_row
   set radar_id = consumed_setups.radar_id
  from consumed_setups
 where setup_row.id = consumed_setups.id
   and consumed_setups.radar_id is not null;

create index if not exists pending_radar_setups_radar_id_idx
  on public.pending_radar_setups (radar_id)
  where radar_id is not null;

create or replace function public.create_radar_from_setup(
  p_setup_id uuid,
  p_user_id uuid,
  p_deadline_at timestamptz
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
  deadline_ms bigint;
begin
  if p_deadline_at is null then
    raise exception 'CREATE_DEADLINE_REQUIRED';
  end if;

  if p_deadline_at <= clock_timestamp() then
    raise exception 'CREATE_DEADLINE_EXCEEDED';
  end if;
  deadline_ms := greatest(
    1::numeric,
    ceil(extract(epoch from (p_deadline_at - clock_timestamp())) * 1000)
  )::bigint;
  perform set_config('lock_timeout', deadline_ms::text, true);
  perform set_config('statement_timeout', deadline_ms::text, true);

  select p.id
    into profile_id
    from public.profiles p
   where p.id = p_user_id
   for update;

  if profile_id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if p_deadline_at <= clock_timestamp() then
    raise exception 'CREATE_DEADLINE_EXCEEDED';
  end if;
  deadline_ms := greatest(
    1::numeric,
    ceil(extract(epoch from (p_deadline_at - clock_timestamp())) * 1000)
  )::bigint;
  perform set_config('lock_timeout', deadline_ms::text, true);
  perform set_config('statement_timeout', deadline_ms::text, true);

  select s.*
    into setup_row
    from public.pending_radar_setups s
   where s.id = p_setup_id
     and s.user_id = p_user_id
   for update;

  if not found then
    raise exception 'SETUP_NOT_AVAILABLE';
  end if;

  if p_deadline_at <= clock_timestamp() then
    raise exception 'CREATE_DEADLINE_EXCEEDED';
  end if;

  if setup_row.status = 'consumed' then
    if setup_row.radar_id is null then
      raise exception 'SETUP_NOT_AVAILABLE';
    end if;

    select r.*
      into radar_row
      from public.radars r
     where r.id = setup_row.radar_id
       and r.user_id = p_user_id;

    if not found then
      raise exception 'SETUP_NOT_AVAILABLE';
    end if;

    return radar_row;
  end if;

  if setup_row.status <> 'pending' or setup_row.expires_at <= clock_timestamp() then
    raise exception 'SETUP_NOT_AVAILABLE';
  end if;

  deadline_ms := greatest(
    1::numeric,
    ceil(extract(epoch from (p_deadline_at - clock_timestamp())) * 1000)
  )::bigint;
  perform set_config('lock_timeout', deadline_ms::text, true);
  perform set_config('statement_timeout', deadline_ms::text, true);

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

  if p_deadline_at <= clock_timestamp() then
    raise exception 'CREATE_DEADLINE_EXCEEDED';
  end if;
  deadline_ms := greatest(
    1::numeric,
    ceil(extract(epoch from (p_deadline_at - clock_timestamp())) * 1000)
  )::bigint;
  perform set_config('lock_timeout', deadline_ms::text, true);
  perform set_config('statement_timeout', deadline_ms::text, true);

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
         radar_id = radar_row.id,
         updated_at = timezone('utc', now())
   where id = p_setup_id;

  return radar_row;
end;
$$;

revoke all on function public.create_radar_from_setup(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_radar_from_setup(uuid, uuid, timestamptz) to service_role;
