create or replace function public.consume_telegram_binding_token(
  p_token_hash text,
  p_chat_id bigint,
  p_username text
)
returns table (
  user_id uuid,
  error_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  token_row public.telegram_binding_tokens%rowtype;
  existing_user_id uuid;
begin
  select t.*
    into token_row
    from public.telegram_binding_tokens t
   where t.token_hash = p_token_hash
     and t.used_at is null
     and t.expires_at > clock_timestamp()
   for update;

  if not found then
    return query select null::uuid, 'TOKEN_INVALID';
    return;
  end if;

  select c.user_id
    into existing_user_id
    from public.telegram_connections c
   where c.chat_id = p_chat_id
   for update;

  if existing_user_id is not null and existing_user_id <> token_row.user_id then
    return query select null::uuid, 'CHAT_ALREADY_BOUND';
    return;
  end if;

  update public.telegram_binding_tokens
     set used_at = timezone('utc', clock_timestamp())
   where id = token_row.id
     and used_at is null;

  insert into public.telegram_connections (
    user_id,
    chat_id,
    telegram_username,
    connected_at
  )
  values (
    token_row.user_id,
    p_chat_id,
    p_username,
    timezone('utc', clock_timestamp())
  )
  on conflict on constraint telegram_connections_pkey do update
    set chat_id = excluded.chat_id,
        telegram_username = excluded.telegram_username,
        connected_at = excluded.connected_at;

  return query select token_row.user_id, null::text;
end;
$$;

revoke all on function public.consume_telegram_binding_token(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.consume_telegram_binding_token(text, bigint, text)
  to service_role;
