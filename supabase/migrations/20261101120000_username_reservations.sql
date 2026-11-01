create table public.username_reservations (
  username text primary key check (username ~ '^[a-z0-9_]{3,24}$'),
  owner_id uuid not null
);

alter table public.username_reservations enable row level security;
revoke all on public.username_reservations from public, anon, authenticated;

insert into public.username_reservations (username, owner_id)
select lower(btrim(username)), id
from public.profiles;

update public.profiles
set username = lower(btrim(username))
where username is distinct from lower(btrim(username));

create or replace function public.reserve_profile_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_username text := lower(btrim(new.username));
  reserved_owner uuid;
begin
  if normalized_username is null or normalized_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must be 3-24 characters using letters, numbers, and underscores'
      using errcode = '23514';
  end if;

  new.username := normalized_username;

  insert into public.username_reservations (username, owner_id)
  values (normalized_username, new.id)
  on conflict (username) do nothing;

  select owner_id into reserved_owner
  from public.username_reservations
  where username = normalized_username;

  if reserved_owner is distinct from new.id then
    raise exception 'Username is already taken'
      using errcode = '23505', constraint = 'username_reservations_pkey';
  end if;

  return new;
end;
$$;

revoke all on function public.reserve_profile_username() from public, anon, authenticated;

create trigger reserve_profile_username_before_write
before insert or update of username on public.profiles
for each row execute function public.reserve_profile_username();

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    lower(btrim(p_username)) ~ '^[a-z0-9_]{3,24}$'
    and not exists (
      select 1
      from public.username_reservations r
      where r.username = lower(btrim(p_username))
        and r.owner_id is distinct from (select auth.uid())
    ),
    false
  );
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;
