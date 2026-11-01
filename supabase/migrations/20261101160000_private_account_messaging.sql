begin;

create or replace function public.can_access_conversation_messaging(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.conversation_participants actor
      where actor.conversation_id = p_conversation_id
        and actor.user_id = (select auth.uid())
    )
    and not exists (
      select 1
      from public.conversation_participants other_participant
      join public.profiles other_profile on other_profile.id = other_participant.user_id
      where other_participant.conversation_id = p_conversation_id
        and other_participant.user_id <> (select auth.uid())
        and (
          public.is_blocked_with(other_participant.user_id)
          or (
            other_profile.is_private
            and not exists (
              select 1
              from public.follows f
              where f.follower_id = (select auth.uid())
                and f.following_id = other_participant.user_id
            )
          )
        )
    );
$$;

create or replace function public.get_message_permission(p_other_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_is_private boolean;
begin
  if actor_id is null or p_other_user_id is null or actor_id = p_other_user_id
     or public.is_blocked_with(p_other_user_id) then
    return 'unavailable';
  end if;

  select p.is_private into target_is_private
  from public.profiles p
  where p.id = p_other_user_id;

  if not found then
    return 'unavailable';
  end if;

  if not target_is_private or exists (
    select 1
    from public.follows f
    where f.follower_id = actor_id
      and f.following_id = p_other_user_id
  ) then
    return 'allowed';
  end if;

  if exists (
    select 1
    from public.follow_requests fr
    where fr.requester_id = actor_id
      and fr.target_id = p_other_user_id
  ) then
    return 'requested';
  end if;

  return 'required';
end;
$$;

revoke all on function public.can_access_conversation_messaging(uuid)
  from public, anon, service_role;
revoke all on function public.get_message_permission(uuid)
  from public, anon, service_role, authenticated;
grant execute on function public.can_access_conversation_messaging(uuid)
  to authenticated;
grant execute on function public.get_message_permission(uuid)
  to authenticated;

create or replace function public.open_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  first_user_id uuid;
  second_user_id uuid;
  existing_conversation_id uuid;
  new_conversation_id uuid;
begin
  if current_user_id is null
     or p_other_user_id is null
     or current_user_id = p_other_user_id then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  perform 1
  from public.profiles p
  where p.id = p_other_user_id
  for share;

  if not found or public.get_message_permission(p_other_user_id) <> 'allowed' then
    raise insufficient_privilege using message = 'Messaging is not available for this account';
  end if;

  first_user_id := least(current_user_id, p_other_user_id);
  second_user_id := greatest(current_user_id, p_other_user_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(first_user_id::text || ':' || second_user_id::text, 0)
  );

  select cp.conversation_id into existing_conversation_id
  from public.conversation_participants cp
  where cp.user_id = current_user_id
    and exists (
      select 1 from public.conversation_participants other_cp
      where other_cp.conversation_id = cp.conversation_id
        and other_cp.user_id = p_other_user_id
    )
    and 2 = (
      select count(*)
      from public.conversation_participants all_cp
      where all_cp.conversation_id = cp.conversation_id
    )
  limit 1;

  if existing_conversation_id is not null then
    return existing_conversation_id;
  end if;

  insert into public.conversations default values returning id into new_conversation_id;
  insert into public.conversation_participants (conversation_id, user_id)
  values (new_conversation_id, current_user_id), (new_conversation_id, p_other_user_id);

  return new_conversation_id;
end;
$$;

revoke all on function public.open_direct_conversation(uuid)
  from public, anon, service_role;
grant execute on function public.open_direct_conversation(uuid) to authenticated;

drop policy if exists "Participants read visible or unlocked conversations"
  on public.conversations;
create policy "Participants read visible or unlocked conversations"
on public.conversations for select to authenticated
using (
  public.is_conversation_participant(id)
  and public.can_access_conversation_messaging(id)
  and (
    not exists (
      select 1 from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id = conversations.id
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(id)
  )
);

drop policy if exists "Participants read members of their conversations"
  on public.conversation_participants;
create policy "Participants read members of their conversations"
on public.conversation_participants for select to authenticated
using (
  public.is_conversation_participant(conversation_id)
  and public.can_access_conversation_messaging(conversation_id)
  and (
    not exists (
      select 1 from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id = conversation_participants.conversation_id
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(conversation_id)
  )
);

drop policy if exists "Participants read visible or unlocked messages"
  on public.messages;
create policy "Participants read visible or unlocked messages"
on public.messages for select to authenticated
using (
  public.is_conversation_participant(conversation_id)
  and public.can_access_conversation_messaging(conversation_id)
  and (
    not exists (
      select 1 from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id = messages.conversation_id
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(conversation_id)
  )
);

drop policy if exists "Participants can send messages as themselves" on public.messages;
create policy "Participants can send messages as themselves"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and public.is_conversation_participant(conversation_id)
  and public.can_access_conversation_messaging(conversation_id)
  and (
    not exists (
      select 1 from public.hidden_chat_preferences hp
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
  and public.can_access_conversation_messaging(conversation_id)
  and (
    not exists (
      select 1 from public.hidden_chat_preferences hp
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
  and public.can_access_conversation_messaging(conversation_id)
  and (
    not exists (
      select 1 from public.hidden_chat_preferences hp
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
  and public.can_access_conversation_messaging(conversation_id)
  and (
    not exists (
      select 1 from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id = messages.conversation_id
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(conversation_id)
  )
);

drop policy if exists "Participants read visible or unlocked message attachments"
  on public.message_attachments;
create policy "Participants read visible or unlocked message attachments"
on public.message_attachments for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_id
      and public.is_conversation_participant(m.conversation_id)
      and public.can_access_conversation_messaging(m.conversation_id)
      and (
        not exists (
          select 1 from public.hidden_chat_preferences hp
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
    select 1 from public.messages m
    where m.id = message_id
      and m.sender_id = (select auth.uid())
      and public.is_conversation_participant(m.conversation_id)
      and public.can_access_conversation_messaging(m.conversation_id)
      and (storage.foldername(storage_path))[1] = (select auth.uid())::text
      and (storage.foldername(storage_path))[2] = m.id::text
      and (
        not exists (
          select 1 from public.hidden_chat_preferences hp
          where hp.user_id = (select auth.uid())
            and hp.conversation_id = m.conversation_id
            and hp.is_hidden
        )
        or public.can_access_hidden_conversation(m.conversation_id)
      )
  )
);

drop policy if exists "Participants upload media for their own messages" on storage.objects;
create policy "Participants upload media for their own messages"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.messages m
    where m.id::text = (storage.foldername(name))[2]
      and m.sender_id = (select auth.uid())
      and public.is_conversation_participant(m.conversation_id)
      and public.can_access_conversation_messaging(m.conversation_id)
      and (
        not exists (
          select 1 from public.hidden_chat_preferences hp
          where hp.user_id = (select auth.uid())
            and hp.conversation_id = m.conversation_id
            and hp.is_hidden
        )
        or public.can_access_hidden_conversation(m.conversation_id)
      )
  )
);

drop policy if exists "Participants retry uploads for their own messages" on storage.objects;
create policy "Participants retry uploads for their own messages"
on storage.objects for update to authenticated
using (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.messages m
    where m.id::text = (storage.foldername(name))[2]
      and m.sender_id = (select auth.uid())
      and public.is_conversation_participant(m.conversation_id)
      and public.can_access_conversation_messaging(m.conversation_id)
      and (
        not exists (
          select 1 from public.hidden_chat_preferences hp
          where hp.user_id = (select auth.uid())
            and hp.conversation_id = m.conversation_id
            and hp.is_hidden
        )
        or public.can_access_hidden_conversation(m.conversation_id)
      )
  )
)
with check (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.messages m
    where m.id::text = (storage.foldername(name))[2]
      and m.sender_id = (select auth.uid())
      and public.is_conversation_participant(m.conversation_id)
      and public.can_access_conversation_messaging(m.conversation_id)
      and (
        not exists (
          select 1 from public.hidden_chat_preferences hp
          where hp.user_id = (select auth.uid())
            and hp.conversation_id = m.conversation_id
            and hp.is_hidden
        )
        or public.can_access_hidden_conversation(m.conversation_id)
      )
  )
);

drop policy if exists "Senders read their visible staged media uploads" on storage.objects;
create policy "Senders read their visible staged media uploads"
on storage.objects for select to authenticated
using (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.messages m
    where m.id::text = (storage.foldername(name))[2]
      and m.sender_id = (select auth.uid())
      and public.is_conversation_participant(m.conversation_id)
      and public.can_access_conversation_messaging(m.conversation_id)
      and (
        not exists (
          select 1 from public.hidden_chat_preferences hp
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
      and public.can_access_conversation_messaging(m.conversation_id)
      and (
        not exists (
          select 1 from public.hidden_chat_preferences hp
          where hp.user_id = (select auth.uid())
            and hp.conversation_id = m.conversation_id
            and hp.is_hidden
        )
        or public.can_access_hidden_conversation(m.conversation_id)
      )
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
  and public.can_access_conversation_messaging(
    pg_catalog.split_part(realtime.topic(), ':', 2)::uuid
  )
  and (
    not exists (
      select 1 from public.hidden_chat_preferences hp
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
  and public.can_access_conversation_messaging(
    pg_catalog.split_part(realtime.topic(), ':', 2)::uuid
  )
  and (
    not exists (
      select 1 from public.hidden_chat_preferences hp
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
