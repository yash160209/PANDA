begin;

drop trigger if exists follows_require_public_target on public.follows;
create trigger follows_require_public_target
before insert on public.follows
for each row execute function public.ensure_follow_target_is_public();

commit;
