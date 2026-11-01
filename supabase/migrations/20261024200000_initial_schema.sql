create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 60),
  bio text not null default '' check (char_length(bio) <= 300),
  website text check (website is null or char_length(website) <= 2048),
  avatar_path text,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table public.follow_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (requester_id, target_id),
  check (requester_id <> target_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 2200),
  media_path text not null check (media_path like author_id::text || '/%'),
  media_type text not null check (media_type in ('image', 'video')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 10000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  storage_path text not null unique,
  media_type text not null check (media_type in ('image', 'video', 'audio')),
  created_at timestamptz not null default now()
);

create table public.hidden_chat_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  is_hidden boolean not null default true,
  muted_until timestamptz,
  hide_notification_preview boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create table public.disappearing_media (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.messages (id) on delete cascade,
  max_views smallint check (max_views is null or max_views in (1, 2)),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.disappearing_media_views (
  media_id uuid not null references public.disappearing_media (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (media_id, viewer_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('like', 'comment', 'follow', 'follow_request', 'message')),
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid references public.profiles (id) on delete set null,
  post_id uuid references public.posts (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index posts_author_created_idx on public.posts (author_id, created_at desc);
create unique index profiles_username_lower_unique_idx on public.profiles (lower(username));
create index comments_post_created_idx on public.comments (post_id, created_at);
create index follows_following_idx on public.follows (following_id);
create index follow_requests_target_idx on public.follow_requests (target_id, created_at desc);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_name text;
begin
  requested_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  requested_name := coalesce(new.raw_user_meta_data ->> 'display_name', '');

  if requested_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'A valid username is required';
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, requested_username, left(requested_name, 60));
  return new;
end;
$$;

revoke all on function public.handle_new_user()
  from public, anon, authenticated, service_role;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_blocked_with(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.blocks b
    where (b.blocker_id = (select auth.uid()) and b.blocked_id = target_id)
       or (b.blocker_id = target_id and b.blocked_id = (select auth.uid()))
  );
$$;

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
create trigger follows_require_public_target
before insert on public.follows
for each row execute function public.ensure_follow_target_is_public();

revoke all on function public.is_blocked_with(uuid) from public;
grant execute on function public.is_blocked_with(uuid) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.follow_requests enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.comments enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.hidden_chat_preferences enable row level security;
alter table public.disappearing_media enable row level security;
alter table public.disappearing_media_views enable row level security;
alter table public.notifications enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

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
    )
  )
);
create policy "Users create their own profile"
on public.profiles for insert to authenticated
with check (id = (select auth.uid()));
create policy "Users update their own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Users read their own follow relationships"
on public.follows for select to authenticated
using (follower_id = (select auth.uid()) or following_id = (select auth.uid()));
create policy "Users follow public profiles"
on public.follows for insert to authenticated
with check (
  follower_id = (select auth.uid())
  and not public.is_blocked_with(following_id)
);
create policy "Either party can remove a follow"
on public.follows for delete to authenticated
using (follower_id = (select auth.uid()) or following_id = (select auth.uid()));

create policy "Parties read their follow requests"
on public.follow_requests for select to authenticated
using (requester_id = (select auth.uid()) or target_id = (select auth.uid()));
create policy "Users request to follow private profiles"
on public.follow_requests for insert to authenticated
with check (requester_id = (select auth.uid()) and not public.is_blocked_with(target_id));
create policy "Target accepts or rejects requests"
on public.follow_requests for delete to authenticated
using (target_id = (select auth.uid()) or requester_id = (select auth.uid()));

create policy "Posts visible to public or approved followers"
on public.posts for select to anon, authenticated
using (
  author_id = (select auth.uid())
  or (
    not public.is_blocked_with(author_id)
    and exists (
      select 1 from public.profiles p
      where p.id = posts.author_id
      and (
        not p.is_private
        or exists (
          select 1 from public.follows f
          where f.follower_id = (select auth.uid()) and f.following_id = p.id
        )
      )
    )
  )
);
create policy "Users create their own posts"
on public.posts for insert to authenticated
with check (author_id = (select auth.uid()));
create policy "Users edit their own posts"
on public.posts for update to authenticated
using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "Users delete their own posts"
on public.posts for delete to authenticated
using (author_id = (select auth.uid()));

create policy "Likes visible with their post"
on public.post_likes for select to anon, authenticated
using (exists (select 1 from public.posts p where p.id = post_id));
create policy "Users like readable posts"
on public.post_likes for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.posts p where p.id = post_id)
);
create policy "Users remove their likes"
on public.post_likes for delete to authenticated
using (user_id = (select auth.uid()));

create policy "Comments visible with their post"
on public.comments for select to anon, authenticated
using (exists (select 1 from public.posts p where p.id = post_id));
create policy "Users comment on readable posts"
on public.comments for insert to authenticated
with check (author_id = (select auth.uid()) and exists (select 1 from public.posts p where p.id = post_id));
create policy "Authors edit their comments"
on public.comments for update to authenticated
using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "Authors delete their comments"
on public.comments for delete to authenticated
using (author_id = (select auth.uid()));

create policy "Conversation participants can read conversations"
on public.conversations for select to authenticated
using (exists (select 1 from public.conversation_participants cp where cp.conversation_id = id and cp.user_id = (select auth.uid())));
create policy "Users see their own participant rows"
on public.conversation_participants for select to authenticated
using (user_id = (select auth.uid()));
create policy "Participants can read messages"
on public.messages for select to authenticated
using (exists (select 1 from public.conversation_participants cp where cp.conversation_id = messages.conversation_id and cp.user_id = (select auth.uid())));
create policy "Participants can send messages as themselves"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (select 1 from public.conversation_participants cp where cp.conversation_id = messages.conversation_id and cp.user_id = (select auth.uid()))
);
create policy "Senders can edit their messages"
on public.messages for update to authenticated
using (sender_id = (select auth.uid())) with check (sender_id = (select auth.uid()));
create policy "Senders can delete their messages"
on public.messages for delete to authenticated
using (sender_id = (select auth.uid()));

create policy "Participants can read message attachments"
on public.message_attachments for select to authenticated
using (
  exists (
    select 1 from public.messages m
    join public.conversation_participants cp on cp.conversation_id = m.conversation_id
    where m.id = message_id and cp.user_id = (select auth.uid())
  )
);
create policy "Users manage their own hidden chat settings"
on public.hidden_chat_preferences for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Participants read disappearing media settings"
on public.disappearing_media for select to authenticated
using (
  exists (
    select 1 from public.messages m
    join public.conversation_participants cp on cp.conversation_id = m.conversation_id
    where m.id = message_id and cp.user_id = (select auth.uid())
  )
);
create policy "View history is visible only to the viewer"
on public.disappearing_media_views for select to authenticated
using (viewer_id = (select auth.uid()));

create policy "Recipients read notifications"
on public.notifications for select to authenticated
using (recipient_id = (select auth.uid()));
create policy "Recipients update their notifications"
on public.notifications for update to authenticated
using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy "Users manage blocks they created"
on public.blocks for all to authenticated
using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));
create policy "Reporters create and read their reports"
on public.reports for select to authenticated using (reporter_id = (select auth.uid()));
create policy "Users submit reports"
on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('post-media', 'post-media', false, 104857600, array['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm']),
  ('message-media', 'message-media', false, 52428800, array['image/jpeg','image/png','image/webp','video/mp4','video/webm','audio/webm','audio/mp4'])
on conflict (id) do nothing;

create policy "Users upload post media into their own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "Post authors replace their own media"
on storage.objects for update to authenticated
using (bucket_id = 'post-media' and owner_id = (select auth.uid())::text)
with check (bucket_id = 'post-media' and owner_id = (select auth.uid())::text);
create policy "Post authors remove their own media"
on storage.objects for delete to authenticated
using (bucket_id = 'post-media' and owner_id = (select auth.uid())::text);
create policy "Readable posts grant private media access"
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'post-media'
  and exists (
    select 1 from public.posts p
    where p.media_path = name
      and (storage.foldername(name))[1] = p.author_id::text
  )
);

create policy "Users upload message media into their own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "Participants read private message media"
on storage.objects for select to authenticated
using (
  bucket_id = 'message-media'
  and exists (
    select 1
    from public.message_attachments a
    join public.messages m on m.id = a.message_id
    join public.conversation_participants cp on cp.conversation_id = m.conversation_id
    where a.storage_path = name and cp.user_id = (select auth.uid())
  )
);

grant select on public.profiles, public.posts, public.post_likes, public.comments to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select, insert, delete on public.follows, public.follow_requests, public.post_likes to authenticated;
grant select, insert, update, delete on public.posts, public.comments to authenticated;
grant select on public.conversations, public.conversation_participants, public.messages,
  public.message_attachments, public.disappearing_media, public.notifications to authenticated;
grant insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.hidden_chat_preferences, public.blocks to authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert on public.reports to authenticated;
