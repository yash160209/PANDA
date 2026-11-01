begin;

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

  if not found or target_is_private then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_follow_target_is_public()
  from public, anon, authenticated, service_role;

drop trigger if exists follows_require_public_target on public.follows;
create trigger follows_require_public_target
before insert on public.follows
for each row execute function public.ensure_follow_target_is_public();

drop policy if exists "Users follow public profiles" on public.follows;
create policy "Users follow public profiles"
on public.follows for insert to authenticated
with check (
  follower_id = (select auth.uid())
  and not public.is_blocked_with(following_id)
);

commit;
