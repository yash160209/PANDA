begin;

create table public.hidden_chat_entry_credentials (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  salt text not null check (salt ~ '^[a-f0-9]{32}$'),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  iterations integer not null check (iterations >= 600000),
  updated_at timestamptz not null default now()
);

create table public.hidden_chat_entry_attempts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count >= 0)
);

alter table public.hidden_chat_entry_credentials enable row level security;
alter table public.hidden_chat_entry_attempts enable row level security;
revoke all on public.hidden_chat_entry_credentials, public.hidden_chat_entry_attempts
  from public, anon, authenticated;
grant select, insert, update, delete on public.hidden_chat_entry_credentials,
  public.hidden_chat_entry_attempts to service_role;

create or replace function public.consume_hidden_chat_entry_attempt(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  insert into public.hidden_chat_entry_attempts as attempts
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

create or replace function public.reset_hidden_chat_entry_attempts(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  delete from public.hidden_chat_entry_attempts where user_id = p_user_id;
end;
$$;

create or replace function public.save_hidden_chat_entry_credential(
  p_user_id uuid,
  p_salt text,
  p_code_hash text,
  p_iterations integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role'
     or p_user_id is null
     or p_salt !~ '^[a-f0-9]{32}$'
     or p_code_hash !~ '^[a-f0-9]{64}$'
     or p_iterations < 600000 then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  insert into public.hidden_chat_entry_credentials (user_id, salt, code_hash, iterations)
  values (p_user_id, p_salt, p_code_hash, p_iterations)
  on conflict (user_id) do update
    set salt = excluded.salt,
        code_hash = excluded.code_hash,
        iterations = excluded.iterations,
        updated_at = pg_catalog.now();

  delete from public.hidden_chat_access_grants
  where user_id = p_user_id;
  delete from public.hidden_chat_entry_attempts where user_id = p_user_id;
end;
$$;

create or replace function public.has_hidden_chat_entry_code()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.hidden_chat_entry_credentials c
      where c.user_id = (select auth.uid())
    );
$$;

revoke all on function public.consume_hidden_chat_entry_attempt(uuid)
  from public, anon, authenticated;
revoke all on function public.reset_hidden_chat_entry_attempts(uuid)
  from public, anon, authenticated;
revoke all on function public.save_hidden_chat_entry_credential(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.has_hidden_chat_entry_code()
  from public, anon, service_role;
grant execute on function public.consume_hidden_chat_entry_attempt(uuid) to service_role;
grant execute on function public.reset_hidden_chat_entry_attempts(uuid) to service_role;
grant execute on function public.save_hidden_chat_entry_credential(uuid, text, text, integer)
  to service_role;
grant execute on function public.has_hidden_chat_entry_code() to authenticated;

create or replace function public.can_user_access_conversation_messaging(
  p_user_id uuid,
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'service_role'
    and p_user_id is not null
    and p_conversation_id is not null
    and exists (
      select 1 from public.conversation_participants actor
      where actor.conversation_id = p_conversation_id
        and actor.user_id = p_user_id
    )
    and not exists (
      select 1
      from public.conversation_participants other_participant
      join public.profiles other_profile on other_profile.id = other_participant.user_id
      where other_participant.conversation_id = p_conversation_id
        and other_participant.user_id <> p_user_id
        and (
          exists (
            select 1 from public.blocks b
            where (b.blocker_id = p_user_id and b.blocked_id = other_participant.user_id)
               or (b.blocker_id = other_participant.user_id and b.blocked_id = p_user_id)
          )
          or (
            other_profile.is_private
            and not exists (
              select 1 from public.follows f
              where f.follower_id = p_user_id
                and f.following_id = other_participant.user_id
            )
          )
        )
    );
$$;

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
  grant_expiry timestamptz;
  listing_expiry timestamptz;
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

  if p_conversation_id is not null then
    if not exists (
      select 1
      from public.conversation_participants cp
      where cp.conversation_id = p_conversation_id
        and cp.user_id = p_user_id
    ) or not exists (
      select 1
      from public.hidden_chat_preferences hp
      where hp.conversation_id = p_conversation_id
        and hp.user_id = p_user_id
        and hp.is_hidden
    ) then
      raise insufficient_privilege using message = 'Not authorized';
    end if;

    select min(g.expires_at) into listing_expiry
    from public.hidden_chat_access_grants g
    where g.user_id = p_user_id
      and g.grant_scope = 'listing'
      and g.conversation_id is null
      and g.expires_at > pg_catalog.clock_timestamp();

    if listing_expiry is null then
      raise insufficient_privilege using message = 'Not authorized';
    end if;
    grant_expiry := least(
      pg_catalog.clock_timestamp() + interval '5 minutes',
      listing_expiry
    );
  else
    grant_expiry := pg_catalog.clock_timestamp() + interval '5 minutes';
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

create or replace function public.list_hidden_conversation_summaries(p_user_id uuid)
returns table (
  id uuid,
  updated_at timestamptz,
  partner_id uuid,
  username text,
  display_name text,
  avatar_path text,
  latest_preview text,
  latest_at timestamptz,
  unread_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  return query
  select
    c.id,
    c.updated_at,
    partner.id,
    partner.username,
    partner.display_name,
    partner.avatar_path,
    latest.preview,
    latest.created_at,
    (
      select count(*)
      from public.messages unread
      where unread.conversation_id = c.id
        and unread.sender_id <> p_user_id
        and unread.read_at is null
    )
  from public.hidden_chat_preferences hp
  join public.conversations c on c.id = hp.conversation_id
  join public.conversation_participants actor
    on actor.conversation_id = c.id and actor.user_id = p_user_id
  join public.conversation_participants other_participant
    on other_participant.conversation_id = c.id and other_participant.user_id <> p_user_id
  join public.profiles partner on partner.id = other_participant.user_id
  left join lateral (
    select
      case
        when m.body <> '' then m.body
        when attachment.media_type = 'video' then 'Video'
        when attachment.media_type is not null then 'Photo'
        else null
      end as preview,
      m.created_at
    from public.messages m
    left join lateral (
      select a.media_type
      from public.message_attachments a
      where a.message_id = m.id
      order by a.created_at
      limit 1
    ) attachment on true
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  where hp.user_id = p_user_id
    and hp.is_hidden
    and public.can_user_access_conversation_messaging(p_user_id, c.id)
  order by c.updated_at desc, c.id;
end;
$$;

create or replace function public.mark_conversation_messages_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  updated_count integer;
begin
  if auth.role() is distinct from 'authenticated'
     or actor_id is null
     or p_conversation_id is null
     or not public.is_conversation_participant(p_conversation_id)
     or not public.can_access_conversation_messaging(p_conversation_id)
     or (
       exists (
         select 1 from public.hidden_chat_preferences hp
         where hp.user_id = actor_id
           and hp.conversation_id = p_conversation_id
           and hp.is_hidden
       )
       and not public.can_access_hidden_conversation(p_conversation_id)
     ) then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  update public.messages
  set read_at = pg_catalog.clock_timestamp()
  where conversation_id = p_conversation_id
    and sender_id <> actor_id
    and read_at is null;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.can_user_access_conversation_messaging(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.list_hidden_conversation_summaries(uuid)
  from public, anon, authenticated;
grant execute on function public.can_user_access_conversation_messaging(uuid, uuid)
  to service_role;
grant execute on function public.list_hidden_conversation_summaries(uuid)
  to service_role;
revoke all on function public.mark_conversation_messages_read(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_conversation_messages_read(uuid)
  to authenticated;

commit;
