begin;

create or replace function public.discover_profiles(
  p_query text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  username text,
  display_name text,
  is_private boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  query_text text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_query, '')));
  row_limit integer := coalesce(p_limit, 100);
begin
  if pg_catalog.char_length(query_text) > 80 or row_limit < 1 or row_limit > 100 then
    raise exception using errcode = '22023', message = 'Invalid profile search';
  end if;

  return query
  select p.id, p.username, p.display_name, p.is_private
  from public.profiles p
  where p.id is distinct from (select auth.uid())
    and not public.is_blocked_with(p.id)
    and (
      query_text = ''
      or pg_catalog.strpos(pg_catalog.lower(p.username), query_text) > 0
      or pg_catalog.strpos(pg_catalog.lower(p.display_name), query_text) > 0
    )
  order by p.created_at desc, p.id
  limit row_limit;
end;
$$;

revoke all on function public.discover_profiles(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.discover_profiles(text, integer)
  to anon, authenticated;

commit;
