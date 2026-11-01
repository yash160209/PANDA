begin;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'stories' and c.relrowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'story_views' and c.relrowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'story_reactions' and c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on every Stories table';
  end if;

  if has_table_privilege('authenticated', 'public.stories', 'INSERT')
     or has_table_privilege('authenticated', 'public.stories', 'UPDATE')
     or has_table_privilege('authenticated', 'public.stories', 'DELETE')
     or has_table_privilege('authenticated', 'public.story_views', 'INSERT')
     or has_table_privilege('authenticated', 'public.story_views', 'DELETE')
     or has_table_privilege('authenticated', 'public.story_reactions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.story_reactions', 'DELETE')
     or has_table_privilege('authenticated', 'public.story_media_cleanup_queue', 'SELECT')
     or has_function_privilege('authenticated', 'public.create_story(uuid, text, text, text)', 'execute') then
    raise exception 'A client can bypass the Stories authorization functions';
  end if;

  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000701', 'authenticated', 'authenticated', 'stories-owner-private@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"story_private_owner"}', now(), now()),
    ('00000000-0000-0000-0000-000000000702', 'authenticated', 'authenticated', 'stories-approved@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"story_approved"}', now(), now()),
    ('00000000-0000-0000-0000-000000000703', 'authenticated', 'authenticated', 'stories-pending@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"story_pending"}', now(), now()),
    ('00000000-0000-0000-0000-000000000704', 'authenticated', 'authenticated', 'stories-owner-public@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"story_public_owner"}', now(), now());

  update public.profiles set is_private = true
  where id = '00000000-0000-0000-0000-000000000701';

  insert into public.follow_requests (requester_id, target_id)
  values
    ('00000000-0000-0000-0000-000000000703', '00000000-0000-0000-0000-000000000701'),
    ('00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000701');
  insert into public.follows (follower_id, following_id)
  values ('00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000701');

  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values
    ('story-media', '00000000-0000-0000-0000-000000000701/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg', '00000000-0000-0000-0000-000000000701', '{"mimetype":"image/jpeg","size":1}'),
    ('story-media', '00000000-0000-0000-0000-000000000702/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg', '00000000-0000-0000-0000-000000000702', '{"mimetype":"image/jpeg","size":1}'),
    ('story-media', '00000000-0000-0000-0000-000000000704/cccccccccccccccccccccccccccccccc.mp4', '00000000-0000-0000-0000-000000000704', '{"mimetype":"video/mp4","size":1}'),
    ('story-media', '00000000-0000-0000-0000-000000000701/dddddddddddddddddddddddddddddddd.jpg', '00000000-0000-0000-0000-000000000701', '{"mimetype":"image/jpeg","size":1}');

  insert into public.stories (id, owner_id, media_type, media_path, caption)
  values
    ('00000000-0000-0000-0000-000000000711', '00000000-0000-0000-0000-000000000701', 'image', '00000000-0000-0000-0000-000000000701/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg', 'private active story'),
    ('00000000-0000-0000-0000-000000000712', '00000000-0000-0000-0000-000000000704', 'video', '00000000-0000-0000-0000-000000000704/cccccccccccccccccccccccccccccccc.mp4', 'public active story'),
    ('00000000-0000-0000-0000-000000000713', '00000000-0000-0000-0000-000000000701', 'image', '00000000-0000-0000-0000-000000000701/dddddddddddddddddddddddddddddddd.jpg', 'expired story');

  update public.stories
  set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
  where id = '00000000-0000-0000-0000-000000000713';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000702', true);
do $$
begin
  if not exists (select 1 from public.stories where id = '00000000-0000-0000-0000-000000000711')
     or not exists (select 1 from storage.objects where bucket_id = 'story-media' and name like '%aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg')
     or exists (select 1 from public.stories where id = '00000000-0000-0000-0000-000000000713') then
    raise exception 'Approved followers must read active private story metadata/media, but never expired stories';
  end if;
  if not exists (select 1 from public.get_story_feed(0, 500) where id = '00000000-0000-0000-0000-000000000711') then
    raise exception 'Approved followers must receive active private stories in the Home feed';
  end if;
  if not public.record_story_view('00000000-0000-0000-0000-000000000711')
     or public.record_story_view('00000000-0000-0000-0000-000000000711') then
    raise exception 'Story views must be recorded once per viewer';
  end if;
  if not public.set_story_reaction('00000000-0000-0000-0000-000000000711', 'heart') then
    raise exception 'An authorized viewer could not react to a story';
  end if;
  if public.set_story_reaction('00000000-0000-0000-0000-000000000711', null) is not true then
    raise exception 'An authorized viewer could not remove a story reaction';
  end if;
  begin
    insert into public.stories (owner_id, media_type, media_path)
    values ('00000000-0000-0000-0000-000000000701', 'image', '00000000-0000-0000-0000-000000000701/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg');
    raise exception 'Direct story insertion unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
begin
  if public.create_story(
    '00000000-0000-0000-0000-000000000702',
    '00000000-0000-0000-0000-000000000702/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg',
    'image',
    'server validated story'
  ) is null then
    raise exception 'The trusted server role could not create a validated story';
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.role', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000703', true);
do $$
begin
  if exists (select 1 from public.stories where id = '00000000-0000-0000-0000-000000000711')
     or exists (select 1 from storage.objects where bucket_id = 'story-media' and name like '%aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg') then
    raise exception 'A pending requester read private story metadata or guessed private media';
  end if;
  if not exists (select 1 from public.stories where id = '00000000-0000-0000-0000-000000000712')
     or not exists (select 1 from storage.objects where bucket_id = 'story-media' and name like '%cccccccccccccccccccccccccccccccc.mp4') then
    raise exception 'Public stories must remain readable by authenticated users';
  end if;
  if exists (select 1 from public.get_story_feed(0, 500) where id = '00000000-0000-0000-0000-000000000711') then
    raise exception 'Pending requests must not grant access through the story feed';
  end if;
  begin
    perform * from public.get_story_feed(null, null);
    raise exception 'Null pagination arguments unexpectedly bypassed feed bounds';
  exception when insufficient_privilege then
    null;
  end;
  if exists (select 1 from public.story_views where story_id = '00000000-0000-0000-0000-000000000711')
     or exists (select 1 from public.story_reactions where story_id = '00000000-0000-0000-0000-000000000711') then
    raise exception 'An unrelated user read another viewer or reaction record';
  end if;
  begin
    perform public.record_story_view('00000000-0000-0000-0000-000000000711');
    raise exception 'A pending requester recorded a private story view';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.delete_story('00000000-0000-0000-0000-000000000711');
    raise exception 'A pending requester deleted another account story';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('story-media', '00000000-0000-0000-0000-000000000701/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.jpg', '00000000-0000-0000-0000-000000000703', '{"mimetype":"image/jpeg","size":1}');
    raise exception 'An authenticated user uploaded into another account story folder';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.set_story_reaction('00000000-0000-0000-0000-000000000711', 'fire');
    raise exception 'A pending requester reacted to a private story';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000704', true);
do $$
begin
  if public.record_story_view('00000000-0000-0000-0000-000000000712') then
    raise exception 'An owner must not be recorded as a viewer of their own story';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000701', true);
do $$
begin
  if (select count(*) from public.story_views where story_id = '00000000-0000-0000-0000-000000000711') <> 1 then
    raise exception 'The story owner must be able to read their active story viewer list';
  end if;
  if public.delete_story('00000000-0000-0000-0000-000000000711') <> '00000000-0000-0000-0000-000000000701/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg' then
    raise exception 'The story owner could not delete their own active story';
  end if;
  if exists (select 1 from public.stories where id = '00000000-0000-0000-0000-000000000711')
     or exists (select 1 from public.story_views where story_id = '00000000-0000-0000-0000-000000000711') then
    raise exception 'Deleting a story must remove its database row and dependent views';
  end if;
end;
$$;

rollback;
