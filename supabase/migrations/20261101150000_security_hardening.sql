begin;

alter table public.hidden_chat_access_grants
  add column if not exists conversation_id uuid
    references public.conversations (id) on delete cascade,
  add column if not exists grant_scope text not null default 'legacy'
    check (grant_scope in ('legacy', 'listing', 'conversation'));

create index if not exists hidden_chat_access_grants_scope_expiry_idx
  on public.hidden_chat_access_grants (user_id, grant_scope, expires_at);

revoke all on function public.handle_new_user()
  from public, anon, authenticated, service_role;

drop function if exists public.create_hidden_chat_access_grant(uuid, text);

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

revoke all on function public.create_hidden_chat_access_grant(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_hidden_chat_access_grant(uuid, uuid, text)
  to service_role;

create or replace function public.can_access_hidden_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  presented_token text;
begin
  if (select auth.uid()) is null
     or p_conversation_id is null
     or not public.is_conversation_participant(p_conversation_id) then
    return false;
  end if;

  presented_token := (
    coalesce(nullif(pg_catalog.current_setting('request.headers', true), ''), '{}')::jsonb
      ->> 'x-panda-hidden-chat-grant'
  );

  if presented_token is null or presented_token !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  return exists (
    select 1
    from public.hidden_chat_access_grants g
    where g.token_hash = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.decode(presented_token, 'hex')),
      'hex'
    )
      and g.user_id = (select auth.uid())
      and g.conversation_id = p_conversation_id
      and g.grant_scope = 'conversation'
      and g.expires_at > pg_catalog.clock_timestamp()
  );
end;
$$;

drop policy if exists "Participants can read message attachments"
  on public.message_attachments;
drop policy if exists "Participants read visible or unlocked message attachments"
  on public.message_attachments;
create policy "Participants read visible or unlocked message attachments"
on public.message_attachments for select to authenticated
using (
  exists (
    select 1
    from public.messages m
    where m.id = message_id
      and public.is_conversation_participant(m.conversation_id)
      and (
        not exists (
          select 1
          from public.hidden_chat_preferences hp
          where hp.user_id = (select auth.uid())
            and hp.conversation_id = m.conversation_id
            and hp.is_hidden
        )
        or public.can_access_hidden_conversation(m.conversation_id)
      )
  )
);

drop policy if exists "Participants attach media to their own messages"
  on public.message_attachments;
create policy "Participants attach media to their own messages"
on public.message_attachments for insert to authenticated
with check (
  exists (
    select 1
    from public.messages m
    where m.id = message_id
      and m.sender_id = (select auth.uid())
      and public.is_conversation_participant(m.conversation_id)
      and (storage.foldername(storage_path))[1] = (select auth.uid())::text
      and (storage.foldername(storage_path))[2] = m.id::text
      and (
        not exists (
          select 1
          from public.hidden_chat_preferences hp
          where hp.user_id = (select auth.uid())
            and hp.conversation_id = m.conversation_id
            and hp.is_hidden
        )
        or public.can_access_hidden_conversation(m.conversation_id)
      )
  )
);

drop policy if exists "Participants read visible or unlocked private message media"
  on storage.objects;
create policy "Participants read visible or unlocked private message media"
on storage.objects for select to authenticated
using (
  bucket_id = 'message-media'
  and exists (
    select 1
    from public.message_attachments a
    join public.messages m on m.id = a.message_id
    where a.storage_path = name
      and (storage.foldername(name))[1] = m.sender_id::text
      and (storage.foldername(name))[2] = m.id::text
      and public.is_conversation_participant(m.conversation_id)
      and (
        not exists (
          select 1
          from public.hidden_chat_preferences hp
          where hp.user_id = (select auth.uid())
            and hp.conversation_id = m.conversation_id
            and hp.is_hidden
        )
        or public.can_access_hidden_conversation(m.conversation_id)
      )
  )
);

drop policy if exists "Participants can send messages as themselves" on public.messages;
create policy "Participants can send messages as themselves"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and public.is_conversation_participant(conversation_id)
  and (
    not exists (
      select 1
      from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id = messages.conversation_id
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(conversation_id)
  )
);

drop policy if exists "Senders can edit their messages" on public.messages;
create policy "Senders can edit their messages"
on public.messages for update to authenticated
using (
  sender_id = (select auth.uid())
  and public.is_conversation_participant(conversation_id)
  and (
    not exists (
      select 1
      from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id = messages.conversation_id
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(conversation_id)
  )
)
with check (
  sender_id = (select auth.uid())
  and public.is_conversation_participant(conversation_id)
  and (
    not exists (
      select 1
      from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id = messages.conversation_id
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(conversation_id)
  )
);

drop policy if exists "Senders can delete their messages" on public.messages;
create policy "Senders can delete their messages"
on public.messages for delete to authenticated
using (
  sender_id = (select auth.uid())
  and public.is_conversation_participant(conversation_id)
  and (
    not exists (
      select 1
      from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id = messages.conversation_id
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(conversation_id)
  )
);

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
