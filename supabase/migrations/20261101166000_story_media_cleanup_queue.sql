begin;

create table public.story_media_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  media_path text not null unique,
  created_at timestamptz not null default now(),
  constraint story_media_cleanup_path_format check (
    media_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{32}\.(jpg|jpeg|png|webp|avif|mp4|webm)$'
  )
);

alter table public.story_media_cleanup_queue enable row level security;
revoke all on public.story_media_cleanup_queue from public, anon, authenticated;
grant all on public.story_media_cleanup_queue to service_role;

commit;
