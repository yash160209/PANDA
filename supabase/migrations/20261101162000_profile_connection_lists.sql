begin;

create or replace function public.get_profile_connections(
  p_profile_id uuid,
  p_connection text,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  bio text,
  avatar_path text,
  is_private boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_is_private boolean;
  row_limit integer := coalesce(p_limit, 50);
  row_offset integer := coalesce(p_offset, 0);
begin
  if actor_id is null
     or p_profile_id is null
     or p_connection is null
     or p_connection not in ('followers', 'following')
     or row_limit < 1
     or row_limit > 50
     or row_offset < 0 then
    raise exception using errcode = '22023', message = 'Invalid profile connection request';
  end if;

  select p.is_private into target_is_private
  from public.profiles p
  where p.id = p_profile_id;

  if not found
     or public.is_blocked_with(p_profile_id)
     or (
       actor_id <> p_profile_id
       and target_is_private
       and not exists (
         select 1
         from public.follows f
         where f.follower_id = actor_id
           and f.following_id = p_profile_id
       )
     ) then
    return;
  end if;

  return query
  select p.id, p.username, p.display_name, p.bio, p.avatar_path, p.is_private
  from public.follows f
  join public.profiles p
    on p.id = case
      when p_connection = 'followers' then f.follower_id
      else f.following_id
    end
  where (
      (p_connection = 'followers' and f.following_id = p_profile_id)
      or (p_connection = 'following' and f.follower_id = p_profile_id)
    )
    and not public.is_blocked_with(p.id)
    and (
      not p.is_private
      or p.id = actor_id
      or exists (
        select 1
        from public.follows viewer_follow
        where viewer_follow.follower_id = actor_id
          and viewer_follow.following_id = p.id
      )
    )
  order by p.username, p.id
  limit row_limit
  offset row_offset;
end;
$$;

revoke all on function public.get_profile_connections(uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_profile_connections(uuid, text, integer, integer)
  to authenticated;

commit;
