begin;

revoke all on function public.handle_new_user()
  from public, anon, authenticated, service_role;

create or replace function public.create_hidden_chat_access_grant(
  p_user_id uuid,
  p_conversation_id uuid,
  p_token_hash text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_expiry timestamptz := pg_catalog.clock_timestamp() + interval '5 minutes';
  current_scope text := case
    when p_conversation_id is null then 'listing'
    else 'conversation'
  end;
begin
  if auth.role() is distinct from 'service_role'
     or p_user_id is null
     or p_token_hash is null
     or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  if p_conversation_id is not null
     and (
       not exists (
         select 1
         from public.conversation_participants cp
         where cp.conversation_id = p_conversation_id
           and cp.user_id = p_user_id
       )
       or not exists (
         select 1
         from public.hidden_chat_preferences hp
         where hp.conversation_id = p_conversation_id
           and hp.user_id = p_user_id
           and hp.is_hidden
       )
     ) then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  delete from public.hidden_chat_access_grants
  where user_id = p_user_id
    and expires_at <= pg_catalog.clock_timestamp();

  insert into public.hidden_chat_access_grants (
    token_hash,
    user_id,
    expires_at,
    conversation_id,
    grant_scope
  )
  values (
    p_token_hash,
    p_user_id,
    grant_expiry,
    p_conversation_id,
    current_scope
  );

  return grant_expiry;
end;
$$;

drop policy if exists "Conversation participants may receive call signals"
  on realtime.messages;
create policy "Conversation participants may receive call signals"
on realtime.messages for select to authenticated
using (
  realtime.topic() ~ '^call:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id::text = pg_catalog.split_part(realtime.topic(), ':', 2)
      and cp.user_id = (select auth.uid())
  )
  and (
    not exists (
      select 1
      from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id::text = pg_catalog.split_part(realtime.topic(), ':', 2)
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(
      pg_catalog.split_part(realtime.topic(), ':', 2)::uuid
    )
  )
);

drop policy if exists "Conversation participants may send call signals"
  on realtime.messages;
create policy "Conversation participants may send call signals"
on realtime.messages for insert to authenticated
with check (
  realtime.topic() ~ '^call:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id::text = pg_catalog.split_part(realtime.topic(), ':', 2)
      and cp.user_id = (select auth.uid())
  )
  and (
    not exists (
      select 1
      from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id::text = pg_catalog.split_part(realtime.topic(), ':', 2)
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(
      pg_catalog.split_part(realtime.topic(), ':', 2)::uuid
    )
  )
);

commit;
