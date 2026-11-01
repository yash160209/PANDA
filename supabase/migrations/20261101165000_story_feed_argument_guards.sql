begin;

create or replace function public.get_story_feed(p_offset integer default 0, p_limit integer default 500)
returns setof public.stories
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or p_offset is null
     or p_limit is null
     or p_offset < 0
     or p_limit < 1
     or p_limit > 500 then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  return query
  select s.*
  from public.stories s
  where s.expires_at > now()
    and public.can_view_story(s.id)
    and (
      s.owner_id = (select auth.uid())
      or exists (
        select 1 from public.follows f
        where f.follower_id = (select auth.uid())
          and f.following_id = s.owner_id
      )
    )
  order by s.created_at, s.id
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.get_story_feed(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.get_story_feed(integer, integer) to authenticated;

commit;
