create table public.username_auth_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0)
);

create index username_auth_rate_limits_window_idx
  on public.username_auth_rate_limits (window_started_at);

alter table public.username_auth_rate_limits enable row level security;

revoke all on public.username_auth_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.username_auth_rate_limits to service_role;

create or replace function public.consume_username_auth_attempt(
  p_username text,
  p_client_address text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_username text := lower(trim(p_username));
  address_key text := 'ip:' || p_client_address;
  username_key text := 'username:' || normalized_username;
  address_attempts integer;
  username_attempts integer;
  window_start timestamptz;
begin
  if auth.role() <> 'service_role'
     or normalized_username !~ '^[a-z0-9_]{3,24}$'
     or char_length(p_client_address) > 64 then
    raise exception 'Invalid username authentication rate-limit request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(address_key, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(username_key, 0));

  insert into public.username_auth_rate_limits as limits
    (bucket_key, window_started_at, attempt_count)
  values (address_key, pg_catalog.now(), 1)
  on conflict (bucket_key) do update
    set window_started_at = case
          when limits.window_started_at <= pg_catalog.now() - interval '15 minutes'
            then pg_catalog.now()
          else limits.window_started_at
        end,
        attempt_count = case
          when limits.window_started_at <= pg_catalog.now() - interval '15 minutes'
            then 1
          else limits.attempt_count + 1
        end
  returning attempt_count into address_attempts;

  insert into public.username_auth_rate_limits as limits
    (bucket_key, window_started_at, attempt_count)
  values (username_key, pg_catalog.now(), 1)
  on conflict (bucket_key) do update
    set window_started_at = case
          when limits.window_started_at <= pg_catalog.now() - interval '15 minutes'
            then pg_catalog.now()
          else limits.window_started_at
        end,
        attempt_count = case
          when limits.window_started_at <= pg_catalog.now() - interval '15 minutes'
            then 1
          else limits.attempt_count + 1
        end
  returning attempt_count into username_attempts;

  delete from public.username_auth_rate_limits
  where window_started_at < pg_catalog.now() - interval '1 day';

  return address_attempts <= 20 and username_attempts <= 8;
end;
$$;

revoke all on function public.consume_username_auth_attempt(text, text) from public, anon, authenticated;
grant execute on function public.consume_username_auth_attempt(text, text) to service_role;
