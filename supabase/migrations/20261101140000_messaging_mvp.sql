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

  if not exists (select 1 from public.profiles p where p.id = p_other_user_id)
     or public.is_blocked_with(p_other_user_id) then
    raise insufficient_privilege using message = 'Not authorized';
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

revoke all on function public.open_direct_conversation(uuid) from public, anon;
grant execute on function public.open_direct_conversation(uuid) to authenticated;

create or replace function public.touch_conversation_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set updated_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

revoke all on function public.touch_conversation_updated_at() from public, anon, authenticated;
create trigger messages_touch_conversation_updated_at
after insert on public.messages
for each row execute function public.touch_conversation_updated_at();

grant insert on public.message_attachments to authenticated;
create policy "Participants attach media to their own messages"
on public.message_attachments for insert to authenticated
with check (
  exists (
    select 1
    from public.messages m
    where m.id = message_id
      and m.sender_id = (select auth.uid())
      and public.is_conversation_participant(m.conversation_id)
  )
);
drop policy if exists "Users upload message media into their own folder" on storage.objects;
create policy "Participants upload media for their own messages"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.messages m
    where m.id::text = (storage.foldername(name))[2]
      and m.sender_id = (select auth.uid())
      and public.is_conversation_participant(m.conversation_id)
  )
);
create policy "Participants retry uploads for their own messages"
on storage.objects for update to authenticated
using (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.messages m
    where m.id::text = (storage.foldername(name))[2]
      and m.sender_id = (select auth.uid())
      and public.is_conversation_participant(m.conversation_id)
  )
)
with check (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.messages m
    where m.id::text = (storage.foldername(name))[2]
      and m.sender_id = (select auth.uid())
      and public.is_conversation_participant(m.conversation_id)
  )
);
create policy "Senders read their visible staged media uploads"
on storage.objects for select to authenticated
using (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.messages m
    where m.id::text = (storage.foldername(name))[2]
      and m.sender_id = (select auth.uid())
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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp','image/avif']
)
on conflict (id) do nothing;

create policy "Users upload their own profile avatars"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "Users replace their own profile avatars"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "Users delete their own profile avatars"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "Users read visible profile avatars"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-avatars'
  and exists (
    select 1
    from public.profiles p
    where p.id::text = (storage.foldername(name))[1]
      and (
        p.id = (select auth.uid())
        or (
          not public.is_blocked_with(p.id)
          and (
            not p.is_private
            or exists (
              select 1
              from public.follows f
              where f.follower_id = (select auth.uid())
                and f.following_id = p.id
            )
          )
        )
      )
  )
);

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

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
