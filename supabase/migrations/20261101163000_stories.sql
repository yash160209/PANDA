begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'story-media',
  'story-media',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/webm']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  media_path text not null unique,
  caption text not null default '' check (char_length(caption) <= 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint stories_media_path_owner check (media_path like owner_id::text || '/%'),
  constraint stories_expires_after_24_hours check (expires_at = created_at + interval '24 hours')
);

create index stories_active_created_idx on public.stories (expires_at, created_at desc, id);
create index stories_owner_active_idx on public.stories (owner_id, expires_at desc, created_at desc);

create table public.story_views (
  story_id uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create index story_views_viewer_idx on public.story_views (viewer_id, story_id);

create table public.story_reactions (
  story_id uuid not null references public.stories (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reaction text not null check (reaction in ('heart', 'fire', 'laugh', 'clap')),
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index story_reactions_user_idx on public.story_reactions (user_id, story_id);

create or replace function public.can_view_story(p_story_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stories s
    join public.profiles owner_profile on owner_profile.id = s.owner_id
    where s.id = p_story_id
      and s.expires_at > now()
      and (
        s.owner_id = (select auth.uid())
        or (
          not public.is_blocked_with(s.owner_id)
          and (
            not owner_profile.is_private
            or exists (
              select 1 from public.follows f
              where f.follower_id = (select auth.uid())
                and f.following_id = s.owner_id
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_view_story(uuid) from public, anon;
grant execute on function public.can_view_story(uuid) to authenticated;

create or replace function public.can_read_story_media(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stories s
    where s.media_path = p_object_path
      and public.can_view_story(s.id)
  );
$$;

revoke all on function public.can_read_story_media(text) from public, anon;
grant execute on function public.can_read_story_media(text) to authenticated;

alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.story_reactions enable row level security;

revoke all on public.stories, public.story_views, public.story_reactions
  from public, anon, authenticated;
grant select on public.stories, public.story_views, public.story_reactions to authenticated;

create policy "Viewers read active authorized stories"
on public.stories for select to authenticated
using (public.can_view_story(id));

create policy "Story owners and viewers read authorized view records"
on public.story_views for select to authenticated
using (
  (viewer_id = (select auth.uid()) and public.can_view_story(story_id))
  or exists (
    select 1 from public.stories s
    where s.id = story_id
      and s.owner_id = (select auth.uid())
      and s.expires_at > now()
  )
);

create policy "Story owners and viewers read authorized reactions"
on public.story_reactions for select to authenticated
using (
  (user_id = (select auth.uid()) and public.can_view_story(story_id))
  or exists (
    select 1 from public.stories s
    where s.id = story_id
      and s.owner_id = (select auth.uid())
      and s.expires_at > now()
  )
);

create or replace function public.create_story(
  p_owner_id uuid,
  p_media_path text,
  p_media_type text,
  p_caption text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  story_id uuid;
begin
  if (select auth.role()) <> 'service_role'
     or p_owner_id is null
     or p_media_path is null
     or p_media_type not in ('image', 'video')
     or char_length(coalesce(p_caption, '')) > 500
     or p_media_path !~ (
       '^' || p_owner_id::text || '/[0-9a-f]{32}\.' ||
       case when p_media_type = 'image' then '(jpg|jpeg|png|webp|avif)' else '(mp4|webm)' end || '$'
     )
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'story-media'
         and o.name = p_media_path
         and (storage.foldername(o.name))[1] = p_owner_id::text
     ) then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  insert into public.stories (owner_id, media_type, media_path, caption)
  values (p_owner_id, p_media_type, p_media_path, coalesce(p_caption, ''))
  returning id into story_id;
  return story_id;
end;
$$;

create or replace function public.record_story_view(p_story_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  story_owner uuid;
begin
  if actor_id is null or p_story_id is null or not public.can_view_story(p_story_id) then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  select s.owner_id into story_owner from public.stories s where s.id = p_story_id;
  if story_owner = actor_id then
    return false;
  end if;

  insert into public.story_views (story_id, viewer_id)
  values (p_story_id, actor_id)
  on conflict (story_id, viewer_id) do nothing;
  return found;
end;
$$;

create or replace function public.set_story_reaction(p_story_id uuid, p_reaction text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  story_owner uuid;
begin
  if actor_id is null or p_story_id is null or not public.can_view_story(p_story_id) then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  select s.owner_id into story_owner from public.stories s where s.id = p_story_id;
  if story_owner = actor_id then
    raise insufficient_privilege using message = 'Not authorized';
  end if;
  if p_reaction is not null and p_reaction not in ('heart', 'fire', 'laugh', 'clap') then
    raise exception using errcode = '22023', message = 'Invalid story reaction';
  end if;

  if p_reaction is null then
    delete from public.story_reactions r
    where r.story_id = p_story_id and r.user_id = actor_id;
    return found;
  end if;

  insert into public.story_reactions as existing (story_id, user_id, reaction)
  values (p_story_id, actor_id, p_reaction)
  on conflict (story_id, user_id) do update
    set reaction = excluded.reaction, created_at = now()
    where existing.reaction is distinct from excluded.reaction;
  return found;
end;
$$;

create or replace function public.get_story_reaction_counts(p_story_id uuid)
returns table (reaction text, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_story(p_story_id) then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  return query
  select r.reaction, count(*)
  from public.story_reactions r
  where r.story_id = p_story_id
  group by r.reaction;
end;
$$;

create or replace function public.delete_story(p_story_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  deleted_path text;
begin
  if actor_id is null or p_story_id is null then
    raise insufficient_privilege using message = 'Not authorized';
  end if;

  delete from public.stories s
  where s.id = p_story_id
    and s.owner_id = actor_id
    and s.expires_at > now()
  returning s.media_path into deleted_path;

  if deleted_path is null then
    raise insufficient_privilege using message = 'Not authorized';
  end if;
  return deleted_path;
end;
$$;

revoke all on function public.create_story(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_story_view(uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_story_reaction(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.get_story_reaction_counts(uuid) from public, anon, authenticated, service_role;
revoke all on function public.delete_story(uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_story(uuid, text, text, text) to service_role;
grant execute on function public.record_story_view(uuid) to authenticated;
grant execute on function public.set_story_reaction(uuid, text) to authenticated;
grant execute on function public.get_story_reaction_counts(uuid) to authenticated;
grant execute on function public.delete_story(uuid) to authenticated;

create policy "Story owners upload to their own story folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'story-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{32}\.(jpg|jpeg|png|webp|avif|mp4|webm)$')
);

create policy "Authorized viewers read active story media"
on storage.objects for select to authenticated
using (
  bucket_id = 'story-media'
  and public.can_read_story_media(name)
);

create policy "Story owners delete their own story media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'story-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

commit;
