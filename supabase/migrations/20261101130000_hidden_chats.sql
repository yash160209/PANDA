create table public.hidden_chat_pin_credentials (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  salt text not null check (salt ~ '^[a-f0-9]{32}$'),
  pin_hash text not null check (pin_hash ~ '^[a-f0-9]{64}$'),
  iterations integer not null check (iterations >= 600000),
  updated_at timestamptz not null default now()
);

create table public.hidden_chat_pin_attempts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count >= 0)
);

create table public.hidden_chat_access_grants (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index hidden_chat_access_grants_user_expiry_idx
  on public.hidden_chat_access_grants (user_id, expires_at);

alter table public.hidden_chat_pin_credentials enable row level security;
alter table public.hidden_chat_pin_attempts enable row level security;
alter table public.hidden_chat_access_grants enable row level security;

revoke all on public.hidden_chat_pin_credentials,
  public.hidden_chat_pin_attempts,
  public.hidden_chat_access_grants from public, anon, authenticated;
grant select, insert, update, delete on public.hidden_chat_pin_credentials,
  public.hidden_chat_pin_attempts,
  public.hidden_chat_access_grants to service_role;

create or replace function public.consume_hidden_chat_pin_attempt(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  insert into public.hidden_chat_pin_attempts as attempts
    (user_id, window_started_at, attempt_count)
  values (p_user_id, pg_catalog.clock_timestamp(), 1)
  on conflict (user_id) do update
    set window_started_at = case
          when attempts.window_started_at <= pg_catalog.clock_timestamp() - interval '15 minutes'
            then pg_catalog.clock_timestamp()
          else attempts.window_started_at
        end,
        attempt_count = case
          when attempts.window_started_at <= pg_catalog.clock_timestamp() - interval '15 minutes'
            then 1
          else attempts.attempt_count + 1
        end
  returning attempt_count into current_count;

  return current_count;
end;
$$;

create or replace function public.reset_hidden_chat_pin_attempts(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  delete from public.hidden_chat_pin_attempts where user_id = p_user_id;
end;
$$;

create or replace function public.create_hidden_chat_access_grant(
  p_user_id uuid,
  p_token_hash text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_expiry timestamptz := pg_catalog.clock_timestamp() + interval '5 minutes';
begin
  if auth.role() <> 'service_role'
     or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  delete from public.hidden_chat_access_grants
  where user_id = p_user_id
    and expires_at <= pg_catalog.clock_timestamp();

  insert into public.hidden_chat_access_grants (token_hash, user_id, expires_at)
  values (p_token_hash, p_user_id, grant_expiry);

  return grant_expiry;
end;
$$;

create or replace function public.save_hidden_chat_pin_credential(
  p_user_id uuid,
  p_salt text,
  p_pin_hash text,
  p_iterations integer,
  p_is_setup boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  if p_is_setup then
    insert into public.hidden_chat_pin_credentials (user_id, salt, pin_hash, iterations)
    values (p_user_id, p_salt, p_pin_hash, p_iterations);
  else
    update public.hidden_chat_pin_credentials
    set salt = p_salt,
        pin_hash = p_pin_hash,
        iterations = p_iterations,
        updated_at = pg_catalog.now()
    where user_id = p_user_id;

    if not found then
      raise exception 'PIN credential does not exist';
    end if;
  end if;

  delete from public.hidden_chat_access_grants where user_id = p_user_id;
end;
$$;

create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_hidden_chat_pin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hidden_chat_pin_credentials c
    where c.user_id = (select auth.uid())
  );
$$;

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
      and g.expires_at > pg_catalog.clock_timestamp()
  );
end;
$$;

revoke all on function public.consume_hidden_chat_pin_attempt(uuid) from public, anon, authenticated;
grant execute on function public.consume_hidden_chat_pin_attempt(uuid) to service_role;
revoke all on function public.reset_hidden_chat_pin_attempts(uuid) from public, anon, authenticated;
grant execute on function public.reset_hidden_chat_pin_attempts(uuid) to service_role;
revoke all on function public.create_hidden_chat_access_grant(uuid, text) from public, anon, authenticated;
grant execute on function public.create_hidden_chat_access_grant(uuid, text) to service_role;
revoke all on function public.save_hidden_chat_pin_credential(uuid, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.save_hidden_chat_pin_credential(uuid, text, text, integer, boolean) to service_role;
revoke all on function public.is_conversation_participant(uuid) from public, anon;
grant execute on function public.is_conversation_participant(uuid) to authenticated, service_role;
revoke all on function public.has_hidden_chat_pin() from public, anon;
grant execute on function public.has_hidden_chat_pin() to authenticated, service_role;
revoke all on function public.can_access_hidden_conversation(uuid) from public, anon;
grant execute on function public.can_access_hidden_conversation(uuid) to authenticated, service_role;
drop policy if exists "Users manage their own hidden chat settings" on public.hidden_chat_preferences;
create policy "Participants read their own hidden chat settings"
on public.hidden_chat_preferences for select to authenticated
using (
  user_id = (select auth.uid())
  and public.is_conversation_participant(conversation_id)
);

create policy "Participants insert their own hidden chat settings"
on public.hidden_chat_preferences for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_conversation_participant(conversation_id)
  and (not is_hidden or public.has_hidden_chat_pin())
);

create policy "Participants update their own hidden chat settings"
on public.hidden_chat_preferences for update to authenticated
using (
  user_id = (select auth.uid())
  and public.is_conversation_participant(conversation_id)
  and (not is_hidden or public.can_access_hidden_conversation(conversation_id))
)
with check (
  user_id = (select auth.uid())
  and public.is_conversation_participant(conversation_id)
  and (
    (is_hidden and public.has_hidden_chat_pin())
    or (not is_hidden and public.can_access_hidden_conversation(conversation_id))
  )
);

create policy "Participants delete their own visible chat settings"
on public.hidden_chat_preferences for delete to authenticated
using (
  user_id = (select auth.uid())
  and public.is_conversation_participant(conversation_id)
  and (not is_hidden or public.can_access_hidden_conversation(conversation_id))
);
drop policy if exists "Conversation participants can read conversations" on public.conversations;
create policy "Participants read visible or unlocked conversations"
on public.conversations for select to authenticated
using (
  public.is_conversation_participant(id)
  and (
    not exists (
      select 1
      from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id = conversations.id
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(id)
  )
);
drop policy if exists "Users see their own participant rows" on public.conversation_participants;
create policy "Participants read members of their conversations"
on public.conversation_participants for select to authenticated
using (
  public.is_conversation_participant(conversation_id)
  and (
    not exists (
      select 1
      from public.hidden_chat_preferences hp
      where hp.user_id = (select auth.uid())
        and hp.conversation_id = conversation_participants.conversation_id
        and hp.is_hidden
    )
    or public.can_access_hidden_conversation(conversation_id)
  )
);
drop policy if exists "Participants can read messages" on public.messages;
create policy "Participants read visible or unlocked messages"
on public.messages for select to authenticated
using (
  public.is_conversation_participant(conversation_id)
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
drop policy if exists "Participants can read message attachments" on public.message_attachments;
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
drop policy if exists "Participants read disappearing media settings" on public.disappearing_media;
create policy "Participants read visible or unlocked disappearing media settings"
on public.disappearing_media for select to authenticated
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
drop policy if exists "Participants read private message media" on storage.objects;
create policy "Participants read visible or unlocked private message media"
on storage.objects for select to authenticated
using (
  bucket_id = 'message-media'
  and exists (
    select 1
    from public.message_attachments a
    join public.messages m on m.id = a.message_id
    where a.storage_path = name
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
