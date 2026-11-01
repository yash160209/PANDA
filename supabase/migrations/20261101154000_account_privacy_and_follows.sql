begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_name text;
  requested_private boolean;
begin
  requested_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  requested_name := coalesce(new.raw_user_meta_data ->> 'display_name', '');
  requested_private := coalesce((new.raw_user_meta_data ->> 'is_private')::boolean, false);

  if requested_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'A valid username is required';
  end if;

  insert into public.profiles (id, username, display_name, is_private)
  values (new.id, requested_username, left(requested_name, 60), requested_private);
  return new;
end;
$$;

revoke all on function public.handle_new_user()
  from public, anon, authenticated, service_role;

create or replace function public.ensure_follow_target_is_public()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_is_private boolean;
begin
  select p.is_private into target_is_private
  from public.profiles p
  where p.id = new.following_id;

  if not found or (
    target_is_private
    and not exists (
      select 1
      from public.follow_requests fr
      where fr.requester_id = new.follower_id
        and fr.target_id = new.following_id
    )
  ) then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_follow_target_is_public()
  from public, anon, authenticated, service_role;

drop policy if exists "Users follow public profiles" on public.follows;
drop policy if exists "Users request to follow private profiles" on public.follow_requests;
drop policy if exists "Target accepts or rejects requests" on public.follow_requests;
drop policy if exists "Either party can remove a follow" on public.follows;

revoke insert, update, delete on public.follows, public.follow_requests
  from public, anon, authenticated;
grant select on public.follows, public.follow_requests to authenticated;

drop policy if exists "Profiles are visible when public or approved" on public.profiles;
create policy "Profiles are visible when public or approved"
on public.profiles for select to anon, authenticated
using (
  id = (select auth.uid())
  or (
    not public.is_blocked_with(id)
    and (
      not is_private
      or exists (
        select 1 from public.follows f
        where f.follower_id = (select auth.uid()) and f.following_id = profiles.id
      )
      or exists (
        select 1 from public.follow_requests fr
        where fr.requester_id = profiles.id and fr.target_id = (select auth.uid())
      )
    )
  )
);

create or replace function public.follow_profile(p_target_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_is_private boolean;
begin
  if actor_id is null or p_target_id is null or actor_id = p_target_id then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  if public.is_blocked_with(p_target_id) then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  select p.is_private into target_is_private
  from public.profiles p
  where p.id = p_target_id
  for share;

  if not found then
    raise exception using errcode = '22023', message = 'Profile not found';
  end if;

  if exists (
    select 1 from public.follows f
    where f.follower_id = actor_id and f.following_id = p_target_id
  ) then
    return 'following';
  end if;

  if target_is_private then
    insert into public.follow_requests (requester_id, target_id)
    values (actor_id, p_target_id)
    on conflict (requester_id, target_id) do nothing;
    return 'requested';
  end if;

  delete from public.follow_requests
  where requester_id = actor_id and target_id = p_target_id;

  insert into public.follows (follower_id, following_id)
  values (actor_id, p_target_id)
  on conflict (follower_id, following_id) do nothing;

  return 'following';
end;
$$;

create or replace function public.unfollow_profile(p_target_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or p_target_id is null or actor_id = p_target_id then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  delete from public.follows
  where follower_id = actor_id and following_id = p_target_id;

  delete from public.follow_requests
  where requester_id = actor_id and target_id = p_target_id;

  return 'none';
end;
$$;

create or replace function public.respond_to_follow_request(
  p_request_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  request_row public.follow_requests%rowtype;
begin
  if actor_id is null or p_request_id is null or p_accept is null then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  select fr.* into request_row
  from public.follow_requests fr
  where fr.id = p_request_id
    and fr.target_id = actor_id
  for update;

  if not found then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  if p_accept then
    if public.is_blocked_with(request_row.requester_id) then
      raise insufficient_privilege using message = 'Not authorized';
    end if;

    insert into public.follows (follower_id, following_id)
    values (request_row.requester_id, request_row.target_id)
    on conflict (follower_id, following_id) do nothing;
  end if;

  delete from public.follow_requests where id = request_row.id;
  return case when p_accept then 'following' else 'declined' end;
end;
$$;

create or replace function public.get_profile_follow_counts(p_profile_id uuid)
returns table (followers bigint, following bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_is_private boolean;
begin
  select p.is_private into target_is_private
  from public.profiles p
  where p.id = p_profile_id;

  if not found or (
    actor_id is distinct from p_profile_id
    and (
      public.is_blocked_with(p_profile_id)
      or (
        target_is_private
        and not exists (
          select 1 from public.follows f
          where f.follower_id = actor_id and f.following_id = p_profile_id
        )
      )
    )
  ) then
    return;
  end if;

  return query
  select
    (select count(*) from public.follows f where f.following_id = p_profile_id),
    (select count(*) from public.follows f where f.follower_id = p_profile_id);
end;
$$;

revoke all on function public.follow_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function public.unfollow_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function public.respond_to_follow_request(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.get_profile_follow_counts(uuid) from public, anon, authenticated, service_role;
grant execute on function public.follow_profile(uuid) to authenticated;
grant execute on function public.unfollow_profile(uuid) to authenticated;
grant execute on function public.respond_to_follow_request(uuid, boolean) to authenticated;
grant execute on function public.get_profile_follow_counts(uuid) to anon, authenticated;

commit;
