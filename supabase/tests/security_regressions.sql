begin;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  ) then
    raise exception 'A public API table has RLS disabled';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd = 'DELETE'
      and coalesce(qual, '') like '%message-media%'
  ) then
    raise exception 'A direct authenticated DELETE policy exists for message-media';
  end if;

  if has_function_privilege('anon', 'public.handle_new_user()', 'execute')
     or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')
     or has_function_privilege('service_role', 'public.handle_new_user()', 'execute') then
    raise exception 'A caller role can directly execute the new-user trigger function';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not (p.proconfig @> array['search_path=""'])
  ) then
    raise exception 'A public SECURITY DEFINER function has an unsafe search_path';
  end if;

  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000401', 'authenticated', 'authenticated', 'security-a@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"security_a"}', now(), now()),
    ('00000000-0000-0000-0000-000000000402', 'authenticated', 'authenticated', 'security-b@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"security_b"}', now(), now()),
    ('00000000-0000-0000-0000-000000000403', 'authenticated', 'authenticated', 'security-c@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"security_c"}', now(), now()),
    ('00000000-0000-0000-0000-000000000404', 'authenticated', 'authenticated', 'security-d@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"security_d"}', now(), now()),
    ('00000000-0000-0000-0000-000000000405', 'authenticated', 'authenticated', 'security-public@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"security_public","is_private":false}', now(), now()),
    ('00000000-0000-0000-0000-000000000406', 'authenticated', 'authenticated', 'security-private@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"security_private","is_private":true}', now(), now());

  if not (select is_private from public.profiles where id = '00000000-0000-0000-0000-000000000406') then
    raise exception 'The signup trigger did not preserve the requested private-account setting';
  end if;
  if (select is_private from public.profiles where id = '00000000-0000-0000-0000-000000000401') then
    raise exception 'A new public account did not receive the public privacy setting';
  end if;

  insert into public.follows (follower_id, following_id)
  values ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000402');

  update public.profiles set is_private = true
  where id = '00000000-0000-0000-0000-000000000402';
  insert into public.follows (follower_id, following_id)
  values ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000401');
  insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000404');

  insert into public.posts (id, author_id, caption, media_path, media_type)
  values
    ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000402', 'private post', '00000000-0000-0000-0000-000000000402/private.jpg', 'image'),
    ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000404', 'public post', '00000000-0000-0000-0000-000000000404/public.jpg', 'image');

  insert into public.comments (id, post_id, author_id, body)
  values
    ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000402', 'private comment'),
    ('00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000404', 'public comment');

  insert into public.post_likes (post_id, user_id)
  values
    ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000402'),
    ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000404');

  insert into public.notifications (id, recipient_id, actor_id, kind, entity_id)
  values (
    '00000000-0000-0000-0000-000000000521',
    '00000000-0000-0000-0000-000000000402',
    '00000000-0000-0000-0000-000000000404',
    'comment',
    '00000000-0000-0000-0000-000000000512'
  );
  insert into public.reports (id, reporter_id, reported_user_id, reason)
  values (
    '00000000-0000-0000-0000-000000000522',
    '00000000-0000-0000-0000-000000000402',
    '00000000-0000-0000-0000-000000000404',
    'fixture report'
  );

  insert into public.conversations (id)
  values
    ('00000000-0000-0000-0000-000000000601'),
    ('00000000-0000-0000-0000-000000000602'),
    ('00000000-0000-0000-0000-000000000603'),
    ('00000000-0000-0000-0000-000000000604'),
    ('00000000-0000-0000-0000-000000000605');

  insert into public.conversation_participants (conversation_id, user_id)
  values
    ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000401'),
    ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000402'),
    ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000401'),
    ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000403'),
    ('00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000401'),
    ('00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000404'),
    ('00000000-0000-0000-0000-000000000604', '00000000-0000-0000-0000-000000000402'),
    ('00000000-0000-0000-0000-000000000604', '00000000-0000-0000-0000-000000000404'),
    ('00000000-0000-0000-0000-000000000605', '00000000-0000-0000-0000-000000000401'),
    ('00000000-0000-0000-0000-000000000605', '00000000-0000-0000-0000-000000000405');

  insert into public.messages (id, conversation_id, sender_id, body)
  values
    ('00000000-0000-0000-0000-000000000611', '00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000401', 'visible message'),
    ('00000000-0000-0000-0000-000000000612', '00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000403', 'hidden message one'),
    ('00000000-0000-0000-0000-000000000613', '00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000401', 'hidden message two'),
    ('00000000-0000-0000-0000-000000000614', '00000000-0000-0000-0000-000000000604', '00000000-0000-0000-0000-000000000402', 'private conversation message'),
    ('00000000-0000-0000-0000-000000000615', '00000000-0000-0000-0000-000000000605', '00000000-0000-0000-0000-000000000401', 'history before privacy change');

  insert into public.message_attachments (id, message_id, storage_path, media_type)
  values (
    '00000000-0000-0000-0000-000000000625',
    '00000000-0000-0000-0000-000000000615',
    '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000615/private-change.jpg',
    'image'
  );

  insert into public.message_attachments (id, message_id, storage_path, media_type)
  values
    ('00000000-0000-0000-0000-000000000621', '00000000-0000-0000-0000-000000000611', '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000611/visible.jpg', 'image'),
    ('00000000-0000-0000-0000-000000000622', '00000000-0000-0000-0000-000000000612', '00000000-0000-0000-0000-000000000403/00000000-0000-0000-0000-000000000612/hidden.jpg', 'image'),
    ('00000000-0000-0000-0000-000000000623', '00000000-0000-0000-0000-000000000613', '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000613/hidden-two.jpg', 'image'),
    ('00000000-0000-0000-0000-000000000624', '00000000-0000-0000-0000-000000000614', '00000000-0000-0000-0000-000000000402/00000000-0000-0000-0000-000000000614/private.jpg', 'image');
  insert into public.disappearing_media (id, message_id, max_views)
  values ('00000000-0000-0000-0000-000000000625', '00000000-0000-0000-0000-000000000612', 1);

  insert into public.hidden_chat_pin_credentials (user_id, salt, pin_hash, iterations)
  values
    ('00000000-0000-0000-0000-000000000401', repeat('a', 32), repeat('b', 64), 600000),
    ('00000000-0000-0000-0000-000000000403', repeat('c', 32), repeat('d', 64), 600000);
  insert into public.hidden_chat_preferences (user_id, conversation_id, is_hidden)
  values
    ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000602', true),
    ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000603', true),
    ('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000602', true),
    ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000601', true);

  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values
    ('post-media', '00000000-0000-0000-0000-000000000402/private.jpg', '00000000-0000-0000-0000-000000000402', '{"mimetype":"image/jpeg","size":1}'),
    ('message-media', '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000611/visible.jpg', '00000000-0000-0000-0000-000000000401', '{"mimetype":"image/jpeg","size":1}'),
    ('message-media', '00000000-0000-0000-0000-000000000403/00000000-0000-0000-0000-000000000612/hidden.jpg', '00000000-0000-0000-0000-000000000403', '{"mimetype":"image/jpeg","size":1}'),
    ('message-media', '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000613/hidden-two.jpg', '00000000-0000-0000-0000-000000000401', '{"mimetype":"image/jpeg","size":1}'),
    ('message-media', '00000000-0000-0000-0000-000000000402/00000000-0000-0000-0000-000000000614/private.jpg', '00000000-0000-0000-0000-000000000402', '{"mimetype":"image/jpeg","size":1}'),
    ('message-media', '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000615/private-change.jpg', '00000000-0000-0000-0000-000000000401', '{"mimetype":"image/jpeg","size":1}');

  insert into realtime.messages (topic, extension, payload, event, private)
  values
    ('call:00000000-0000-0000-0000-000000000601', 'broadcast', '{}', 'security-test', true),
    ('call:00000000-0000-0000-0000-000000000602', 'broadcast', '{}', 'security-test', true),
    ('call:00000000-0000-0000-0000-000000000603', 'broadcast', '{}', 'security-test', true),
    ('call:00000000-0000-0000-0000-000000000604', 'broadcast', '{}', 'security-test', true),
    ('call:00000000-0000-0000-0000-000000000605', 'broadcast', '{}', 'security-test', true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select set_config('request.headers', '{}', true);
select set_config('realtime.topic', 'call:00000000-0000-0000-0000-000000000601', true);

do $$
declare
  affected integer;
begin
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000614') <> 0 then
    raise exception 'An unrelated user read another private conversation message';
  end if;
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000612') <> 0 then
    raise exception 'A locked hidden conversation message was readable';
  end if;
  if (select count(*) from public.message_attachments where message_id = '00000000-0000-0000-0000-000000000612') <> 0 then
    raise exception 'A locked hidden conversation attachment was readable';
  end if;
  if (select count(*) from public.disappearing_media where message_id = '00000000-0000-0000-0000-000000000612') <> 0 then
    raise exception 'A locked hidden disappearing-media setting was readable';
  end if;
  if (select count(*) from storage.objects where name = '00000000-0000-0000-0000-000000000402/00000000-0000-0000-0000-000000000614/private.jpg') <> 0 then
    raise exception 'A guessed private media path was readable';
  end if;
  if (select count(*) from public.conversation_participants where conversation_id = '00000000-0000-0000-0000-000000000604') <> 0 then
    raise exception 'An unrelated user read another conversation participant list';
  end if;
  if (select count(*) from public.hidden_chat_preferences where user_id = '00000000-0000-0000-0000-000000000402') <> 0 then
    raise exception 'An unrelated user read another user hidden-chat preferences';
  end if;
  if (select count(*) from public.profiles where id = '00000000-0000-0000-0000-000000000402') <> 1 then
    raise exception 'An approved follower could not read a private profile';
  end if;
  if not exists (
    select 1 from public.get_profile_connections(
      '00000000-0000-0000-0000-000000000402',
      'followers'
    ) where id = auth.uid()
  ) then
    raise exception 'An approved follower could not read the permitted follower list';
  end if;
  if not exists (
    select 1 from public.get_profile_connections(
      '00000000-0000-0000-0000-000000000402',
      'following'
    )
  ) then
    raise exception 'An approved follower could not read the permitted following list';
  end if;
  if (select count(*) from public.posts where id = '00000000-0000-0000-0000-000000000501') <> 1 then
    raise exception 'An approved follower could not read a private-account post';
  end if;
  if (select count(*) from public.posts where id = '00000000-0000-0000-0000-000000000502') <> 1 then
    raise exception 'Public content was not readable by an authenticated user';
  end if;
  if (select count(*) from public.comments where post_id = '00000000-0000-0000-0000-000000000501') <> 1 then
    raise exception 'An approved follower could not read a comment on a private post';
  end if;
  if (select count(*) from public.post_likes where post_id = '00000000-0000-0000-0000-000000000501') <> 1 then
    raise exception 'An approved follower could not read likes on a private post';
  end if;
  if (select count(*) from public.disappearing_media where message_id = '00000000-0000-0000-0000-000000000612') <> 0 then
    raise exception 'A locked disappearing-media setting was readable';
  end if;
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000611') <> 1 then
    raise exception 'A conversation participant could not read a visible message';
  end if;
  if (select count(*) from public.message_attachments where message_id = '00000000-0000-0000-0000-000000000611') <> 1 then
    raise exception 'A conversation participant could not read a visible attachment';
  end if;
  if (select count(*) from storage.objects where name = '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000611/visible.jpg') <> 1 then
    raise exception 'A conversation participant could not read authorized media';
  end if;

  insert into public.comments (post_id, author_id, body)
  values ('00000000-0000-0000-0000-000000000501', auth.uid(), 'approved follower comment');
  insert into public.post_likes (post_id, user_id)
  values ('00000000-0000-0000-0000-000000000501', auth.uid());

  if public.follow_profile('00000000-0000-0000-0000-000000000404') <> 'following' then
    raise exception 'Following a public account was not immediate';
  end if;
  if exists (
    select 1 from public.follow_requests
    where requester_id = auth.uid() and target_id = '00000000-0000-0000-0000-000000000404'
  ) then
    raise exception 'Following a public account created an unnecessary request';
  end if;

  update public.profiles set is_private = true where id = auth.uid();
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'A user could not change their own privacy setting'; end if;
  update public.profiles set is_private = false where id = auth.uid();
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'A user could not restore their own privacy setting'; end if;

  update public.profiles set bio = 'spoofed'
  where id = '00000000-0000-0000-0000-000000000402';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A user modified another profile'; end if;
  update public.profiles set is_private = false
  where id = '00000000-0000-0000-0000-000000000402';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A user changed another profile privacy setting'; end if;
  begin
    delete from public.profiles
    where id = '00000000-0000-0000-0000-000000000402';
    if found then raise exception 'A user deleted another profile'; end if;
  exception when insufficient_privilege then null;
  end;

  update public.posts set caption = 'spoofed'
  where id = '00000000-0000-0000-0000-000000000501';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A user modified another post'; end if;
  delete from public.posts where id = '00000000-0000-0000-0000-000000000501';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A user deleted another post'; end if;

  update public.comments set body = 'spoofed'
  where id = '00000000-0000-0000-0000-000000000511';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A user modified another comment'; end if;
  delete from public.comments where id = '00000000-0000-0000-0000-000000000511';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A user deleted another comment'; end if;

  delete from public.post_likes
  where post_id = '00000000-0000-0000-0000-000000000501'
    and user_id = '00000000-0000-0000-0000-000000000402';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A user deleted another user like'; end if;
  begin
    update public.post_likes set created_at = now()
    where post_id = '00000000-0000-0000-0000-000000000501'
      and user_id = '00000000-0000-0000-0000-000000000402';
    if found then raise exception 'A user modified another user like'; end if;
  exception when insufficient_privilege then null;
  end;

  update public.notifications set read_at = now()
  where id = '00000000-0000-0000-0000-000000000521';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A user modified another notification'; end if;
  begin
    delete from public.notifications
    where id = '00000000-0000-0000-0000-000000000521';
    if found then raise exception 'A user deleted another notification'; end if;
  exception when insufficient_privilege then null;
  end;

  if (select count(*) from public.reports where id = '00000000-0000-0000-0000-000000000522') <> 0 then
    raise exception 'A user read another user report';
  end if;

  begin
    insert into public.messages (conversation_id, sender_id, body)
    values ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000402', 'spoofed sender');
    raise exception 'A user sent a message with a spoofed sender_id';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.conversation_participants (conversation_id, user_id)
    values ('00000000-0000-0000-0000-000000000604', auth.uid());
    raise exception 'A user joined an arbitrary conversation';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.messages (conversation_id, sender_id, body)
    values ('00000000-0000-0000-0000-000000000603', auth.uid(), 'message in locked chat');
    raise exception 'A user sent a message to their locked hidden conversation';
  exception when insufficient_privilege then null;
  end;

  update public.messages set body = 'spoofed'
  where id = '00000000-0000-0000-0000-000000000613';
  if found then raise exception 'A user edited a message in their locked hidden conversation'; end if;
  delete from public.messages where id = '00000000-0000-0000-0000-000000000613';
  if found then raise exception 'A user deleted a message in their locked hidden conversation'; end if;

  begin
    insert into public.message_attachments (message_id, storage_path, media_type)
    values (
      '00000000-0000-0000-0000-000000000611',
      '00000000-0000-0000-0000-000000000402/00000000-0000-0000-0000-000000000614/stolen.jpg',
      'image'
    );
    raise exception 'A user attached a guessed third-party storage path';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.message_attachments (message_id, storage_path, media_type)
    values (
      '00000000-0000-0000-0000-000000000614',
      '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000614/stolen.jpg',
      'image'
    );
    raise exception 'A user attached media to a message they do not own';
  exception when insufficient_privilege then null;
  end;

  insert into public.message_attachments (message_id, storage_path, media_type)
  values (
    '00000000-0000-0000-0000-000000000611',
    '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000611/own.jpg',
    'image'
  );

  update public.hidden_chat_preferences set is_hidden = false
  where user_id = '00000000-0000-0000-0000-000000000402'
    and conversation_id = '00000000-0000-0000-0000-000000000601';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A user altered another user hidden-chat preference'; end if;

  update storage.objects set metadata = '{"mimetype":"image/jpeg","size":2}'
  where name = '00000000-0000-0000-0000-000000000402/00000000-0000-0000-0000-000000000614/private.jpg';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A user replaced another user private media'; end if;
  if (select count(*) from realtime.messages where topic = 'call:00000000-0000-0000-0000-000000000601') <> 1 then
    raise exception 'An authorized participant could not read a call topic';
  end if;

  perform set_config('realtime.topic', 'call:00000000-0000-0000-0000-000000000604', true);
  if (select count(*) from realtime.messages where topic = 'call:00000000-0000-0000-0000-000000000604') <> 0 then
    raise exception 'An unrelated user read another conversation call topic';
  end if;

  begin
    insert into realtime.messages (topic, extension, payload, event, private)
    values ('call:00000000-0000-0000-0000-000000000604', 'broadcast', '{}', 'unauthorized', true);
    raise exception 'An unrelated user published to another conversation call topic';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.create_hidden_chat_access_grant(
  '00000000-0000-0000-0000-000000000401',
  null,
  encode(pg_catalog.sha256(decode(repeat('d', 64), 'hex')), 'hex')
);
select public.create_hidden_chat_access_grant(
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000602',
  encode(pg_catalog.sha256(decode(repeat('f', 64), 'hex')), 'hex')
);
select public.create_hidden_chat_access_grant(
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000603',
  encode(pg_catalog.sha256(decode(repeat('e', 64), 'hex')), 'hex')
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select set_config('request.headers', '{"x-panda-hidden-chat-grant":"' || repeat('f', 64) || '"}', true);
select set_config('realtime.topic', 'call:00000000-0000-0000-0000-000000000602', true);

do $$
declare
  affected integer;
begin
  if not public.can_access_hidden_conversation('00000000-0000-0000-0000-000000000602') then
    raise exception 'A valid conversation-scoped grant was rejected';
  end if;
  if public.can_access_hidden_conversation('00000000-0000-0000-0000-000000000603') then
    raise exception 'A grant for one conversation unlocked another hidden conversation';
  end if;
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000612') <> 1 then
    raise exception 'A scoped grant did not unlock its hidden message';
  end if;
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000613') <> 0 then
    raise exception 'A scoped grant unlocked a different hidden message';
  end if;
  if (select count(*) from public.message_attachments where message_id = '00000000-0000-0000-0000-000000000612') <> 1 then
    raise exception 'A scoped grant did not unlock its attachment metadata';
  end if;
  if (select count(*) from public.disappearing_media where message_id = '00000000-0000-0000-0000-000000000612') <> 1 then
    raise exception 'A scoped grant did not unlock its disappearing-media setting';
  end if;
  if (select count(*) from storage.objects where name = '00000000-0000-0000-0000-000000000403/00000000-0000-0000-0000-000000000612/hidden.jpg') <> 1 then
    raise exception 'A scoped grant did not unlock its media object';
  end if;
  if (select count(*) from realtime.messages where topic = 'call:00000000-0000-0000-0000-000000000602') <> 1 then
    raise exception 'A scoped grant did not unlock its authorized call topic';
  end if;

  update public.hidden_chat_preferences
  set is_hidden = false
  where user_id = auth.uid()
    and conversation_id = '00000000-0000-0000-0000-000000000602';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'The scoped grant could not unhide its conversation'; end if;

  perform set_config('request.headers', '{}', true);
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000612') <> 1 then
    raise exception 'An unhidden conversation remained inaccessible';
  end if;
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000613') <> 0 then
    raise exception 'Unhiding one conversation exposed another hidden conversation';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select set_config('request.headers', '{"x-panda-hidden-chat-grant":"' || repeat('d', 64) || '"}', true);
do $$
begin
  if public.can_access_hidden_conversation('00000000-0000-0000-0000-000000000603') then
    raise exception 'A listing-only grant unlocked a hidden conversation';
  end if;
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000613') <> 0 then
    raise exception 'A listing-only grant exposed hidden messages';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000403', true);
select set_config('request.headers', '{"x-panda-hidden-chat-grant":"' || repeat('f', 64) || '"}', true);
select set_config('realtime.topic', 'call:00000000-0000-0000-0000-000000000602', true);

do $$
begin
  if public.can_access_hidden_conversation('00000000-0000-0000-0000-000000000602') then
    raise exception 'A grant was reusable by a different user';
  end if;
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000612') <> 0 then
    raise exception 'A different user reused the grant to read a hidden message';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000403', true);
select set_config('request.headers', '{}', true);

do $$
begin
  if (select count(*) from public.profiles where id = '00000000-0000-0000-0000-000000000402') <> 0 then
    raise exception 'An unapproved user read a private profile';
  end if;
  if not exists (
    select 1
    from public.discover_profiles(null, 100)
    where id = '00000000-0000-0000-0000-000000000402'
      and username = 'security_b'
      and is_private
  ) then
    raise exception 'A private account was not safely discoverable for follow requests';
  end if;
  if exists (
    select 1
    from public.discover_profiles(null, 100)
    where id = '00000000-0000-0000-0000-000000000404'
  ) then
    raise exception 'A blocked account was returned by profile discovery';
  end if;
  if (select count(*) from public.posts where id = '00000000-0000-0000-0000-000000000501') <> 0 then
    raise exception 'An unapproved user read a private-account post';
  end if;
  if (select count(*) from storage.objects where name = '00000000-0000-0000-0000-000000000402/private.jpg') <> 0 then
    raise exception 'An unapproved user read private post media';
  end if;
  if (select count(*) from public.comments where post_id = '00000000-0000-0000-0000-000000000501') <> 0 then
    raise exception 'An unapproved user read comments on a private post';
  end if;
  if (select count(*) from public.post_likes where post_id = '00000000-0000-0000-0000-000000000501') <> 0 then
    raise exception 'An unapproved user read likes on a private post';
  end if;
  if (select count(*) from public.posts where id = '00000000-0000-0000-0000-000000000502') <> 0 then
    raise exception 'A blocked user read the blocked account public post';
  end if;
  if (select count(*) from public.comments where post_id = '00000000-0000-0000-0000-000000000502') <> 0 then
    raise exception 'A blocked user read comments from the blocked account';
  end if;
  if (select count(*) from public.post_likes where post_id = '00000000-0000-0000-0000-000000000502') <> 0 then
    raise exception 'A blocked user read likes from the blocked account';
  end if;

  begin
    insert into public.comments (post_id, author_id, body)
    values ('00000000-0000-0000-0000-000000000501', auth.uid(), 'unauthorized private comment');
    raise exception 'An unapproved user commented on a private post';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.post_likes (post_id, user_id)
    values ('00000000-0000-0000-0000-000000000501', auth.uid());
    raise exception 'An unapproved user liked a private post';
  exception when insufficient_privilege then null;
  end;

  if public.follow_profile('00000000-0000-0000-0000-000000000402') <> 'requested'
     or public.follow_profile('00000000-0000-0000-0000-000000000402') <> 'requested' then
    raise exception 'A private-account follow did not create an idempotent request';
  end if;
  if (select count(*) from public.follow_requests
      where requester_id = auth.uid() and target_id = '00000000-0000-0000-0000-000000000402') <> 1 then
    raise exception 'A repeated private-account follow created duplicate requests';
  end if;
  if (select count(*) from public.posts where id = '00000000-0000-0000-0000-000000000501') <> 0 then
    raise exception 'A pending follow request granted access to private posts';
  end if;
  if exists (
    select 1 from public.get_profile_follow_counts('00000000-0000-0000-0000-000000000402')
  ) then raise exception 'A pending request exposed private follower counts'; end if;
  perform set_config(
    'panda.test_follow_request_id',
    (select id::text from public.follow_requests
     where requester_id = auth.uid() and target_id = '00000000-0000-0000-0000-000000000402'),
    true
  );
  begin
    insert into public.follows (follower_id, following_id)
    values (auth.uid(), '00000000-0000-0000-0000-000000000402');
    raise exception 'A caller directly inserted a follow relationship';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.follow_requests (requester_id, target_id)
    values (auth.uid(), '00000000-0000-0000-0000-000000000404');
    raise exception 'A caller directly inserted a follow request';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.follow_profile('00000000-0000-0000-0000-000000000404');
    raise exception 'A blocked user sent a follow request';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.follow_profile(auth.uid());
    raise exception 'A user followed themselves';
  exception when insufficient_privilege then null;
  end;

  update public.comments set body = 'spoofed'
  where id = '00000000-0000-0000-0000-000000000512';
  if found then raise exception 'A user modified another public-post comment'; end if;
  delete from public.comments where id = '00000000-0000-0000-0000-000000000512';
  if found then raise exception 'A user deleted another public-post comment'; end if;

  update public.reports set reason = 'spoofed'
  where id = '00000000-0000-0000-0000-000000000522';
  if found then raise exception 'A user modified another user report'; end if;
  delete from public.reports
  where id = '00000000-0000-0000-0000-000000000522';
  if found then raise exception 'A user deleted another user report'; end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
do $$
begin
  if (select count(*) from public.follow_requests
      where id = current_setting('panda.test_follow_request_id', true)::uuid) <> 0 then
    raise exception 'An unrelated follower read another user follow request';
  end if;
  begin
    perform public.respond_to_follow_request(
      current_setting('panda.test_follow_request_id', true)::uuid,
      true
    );
    raise exception 'An unrelated user accepted another account follow request';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
do $$
declare
  pending_id uuid;
begin
  select id into pending_id from public.follow_requests
  where requester_id = '00000000-0000-0000-0000-000000000403'
    and target_id = auth.uid();
  if pending_id is null then raise exception 'A private account owner could not read the incoming request'; end if;
  if public.respond_to_follow_request(pending_id, true) <> 'following' then
    raise exception 'A private account owner could not accept a follow request';
  end if;
  if exists (
    select 1 from public.follow_requests where id = pending_id
  ) then
    raise exception 'An accepted follow request was not removed';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000403', true);
do $$
begin
  if not exists (
    select 1 from public.follows
    where follower_id = auth.uid() and following_id = '00000000-0000-0000-0000-000000000402'
  ) then raise exception 'Accepting the request did not create an approved follow'; end if;
  if (select count(*) from public.posts where id = '00000000-0000-0000-0000-000000000501') <> 1 then
    raise exception 'An approved requester could not read private posts';
  end if;
  if (select count(*) from storage.objects where name = '00000000-0000-0000-0000-000000000402/private.jpg') <> 1 then
    raise exception 'An approved requester could not read private post media';
  end if;
  if (select count(*) from public.comments where post_id = '00000000-0000-0000-0000-000000000501') <> 2 then
    raise exception 'An approved requester could not read private-post comments';
  end if;
  if (select count(*) from public.post_likes where post_id = '00000000-0000-0000-0000-000000000501') <> 2 then
    raise exception 'An approved requester could not read private-post likes';
  end if;
  if not exists (
    select 1 from public.get_profile_follow_counts('00000000-0000-0000-0000-000000000402')
    where followers = 2
  ) then
    raise exception 'Approved followers did not receive accurate follower counts';
  end if;
end;
$$;

select public.unfollow_profile('00000000-0000-0000-0000-000000000402');

do $$
begin
  if exists (
    select 1 from public.follows
    where follower_id = auth.uid() and following_id = '00000000-0000-0000-0000-000000000402'
  ) then raise exception 'Unfollowing did not remove the relationship'; end if;
  if (select count(*) from public.posts where id = '00000000-0000-0000-0000-000000000501') <> 0 then
    raise exception 'Unfollowing did not revoke private-post access';
  end if;
  if (select count(*) from storage.objects where name = '00000000-0000-0000-0000-000000000402/private.jpg') <> 0 then
    raise exception 'Unfollowing did not revoke private post media access';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000404', true);
do $$
begin
  if public.follow_profile('00000000-0000-0000-0000-000000000402') <> 'requested' then
    raise exception 'A request to a private account was not pending';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
do $$
declare
  pending_id uuid;
begin
  select id into pending_id from public.follow_requests
  where requester_id = '00000000-0000-0000-0000-000000000404'
    and target_id = auth.uid();
  if pending_id is null then raise exception 'The decline test request was not created'; end if;
  if not exists (
    select 1 from public.get_profile_follow_counts(auth.uid())
    where followers = 1
  ) then raise exception 'Unfollowing did not update the account follower count'; end if;
  if public.respond_to_follow_request(pending_id, false) <> 'declined' then
    raise exception 'A private account owner could not decline a follow request';
  end if;
  if exists (
    select 1 from public.follows
    where follower_id = '00000000-0000-0000-0000-000000000404'
      and following_id = auth.uid()
  ) then raise exception 'Declining a request created a follow relationship'; end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000404', true);
do $$
begin
  if (select count(*) from public.follow_requests
      where requester_id = auth.uid() and target_id = '00000000-0000-0000-0000-000000000402') <> 0 then
    raise exception 'A declined request remained pending';
  end if;
  if (select count(*) from public.posts where id = '00000000-0000-0000-0000-000000000501') <> 0 then
    raise exception 'A declined requester could read private posts';
  end if;
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if (select count(*) from public.posts where id = '00000000-0000-0000-0000-000000000502') <> 1 then
    raise exception 'Anonymous users could not read public posts';
  end if;
  if (select count(*) from public.posts where id = '00000000-0000-0000-0000-000000000501') <> 0 then
    raise exception 'Anonymous users read a private-account post';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select set_config('request.headers', '{}', true);
select set_config('realtime.topic', 'call:00000000-0000-0000-0000-000000000605', true);
do $$
declare
  opened_id uuid;
begin
  if public.get_message_permission('00000000-0000-0000-0000-000000000405') <> 'allowed' then
    raise exception 'Messaging a public account was not allowed';
  end if;
  opened_id := public.open_direct_conversation('00000000-0000-0000-0000-000000000405');
  if opened_id <> '00000000-0000-0000-0000-000000000605' then
    raise exception 'Opening a public account did not reuse its existing conversation';
  end if;
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000615') <> 1
     or (select count(*) from public.message_attachments where message_id = '00000000-0000-0000-0000-000000000615') <> 1
     or (select count(*) from storage.objects where name = '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000615/private-change.jpg') <> 1 then
    raise exception 'Public-account conversation history and media were not accessible';
  end if;
  insert into public.messages (conversation_id, sender_id, body)
  values ('00000000-0000-0000-0000-000000000605', auth.uid(), 'public-account message');
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000405', true);
do $$
begin
  if exists (
    select 1 from public.get_profile_connections(
      '00000000-0000-0000-0000-000000000402',
      'followers'
    )
  ) then
    raise exception 'An unapproved user read a private account connection list';
  end if;
end;
$$;
update public.profiles set is_private = true where id = auth.uid();
do $$
begin
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000615') <> 1 then
    raise exception 'Changing privacy unexpectedly deleted existing message history';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select set_config('request.headers', '{}', true);
select set_config('realtime.topic', 'call:00000000-0000-0000-0000-000000000605', true);
do $$
begin
  if public.get_message_permission('00000000-0000-0000-0000-000000000405') <> 'required' then
    raise exception 'An unapproved user was not asked to request access to a private account';
  end if;
  if (select count(*) from public.messages where conversation_id = '00000000-0000-0000-0000-000000000605') <> 0
     or (select count(*) from public.conversation_participants where conversation_id = '00000000-0000-0000-0000-000000000605') <> 0
     or (select count(*) from public.message_attachments where message_id = '00000000-0000-0000-0000-000000000615') <> 0
     or (select count(*) from storage.objects where name = '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000615/private-change.jpg') <> 0 then
    raise exception 'An unapproved user retained access to an existing private-account conversation';
  end if;
  if (select count(*) from realtime.messages where topic = 'call:00000000-0000-0000-0000-000000000605') <> 0 then
    raise exception 'An unapproved user could read a private-account call topic';
  end if;
  begin
    perform public.open_direct_conversation('00000000-0000-0000-0000-000000000405');
    raise exception 'An unapproved user opened a private-account conversation';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.messages (conversation_id, sender_id, body)
    values ('00000000-0000-0000-0000-000000000605', auth.uid(), 'direct API bypass');
    raise exception 'An unapproved user directly inserted a private-account message';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.message_attachments (message_id, storage_path, media_type)
    values (
      '00000000-0000-0000-0000-000000000615',
      '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000615/bypass.jpg',
      'image'
    );
    raise exception 'An unapproved user attached media to an existing private-account message';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'message-media',
      '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000615/bypass.jpg',
      auth.uid(),
      '{"mimetype":"image/jpeg","size":1}'
    );
    raise exception 'An unapproved user uploaded media to a private-account conversation';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into realtime.messages (topic, extension, payload, event, private)
    values ('call:00000000-0000-0000-0000-000000000605', 'broadcast', '{}', 'unauthorized', true);
    raise exception 'An unapproved user published to a private-account call topic';
  exception when insufficient_privilege then null;
  end;
end;
$$;

do $$
declare
  follow_status text;
  permission_status text;
begin
  follow_status := public.follow_profile('00000000-0000-0000-0000-000000000405');
  permission_status := public.get_message_permission('00000000-0000-0000-0000-000000000405');
  if follow_status <> 'requested' or permission_status <> 'requested' then
    raise exception 'A pending private follow request was not reflected in messaging status: follow %, permission %',
      follow_status, permission_status;
  end if;
  begin
    perform public.open_direct_conversation('00000000-0000-0000-0000-000000000405');
    raise exception 'A pending requester opened a private-account conversation';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.messages (conversation_id, sender_id, body)
    values ('00000000-0000-0000-0000-000000000605', auth.uid(), 'pending request bypass');
    raise exception 'A pending requester sent a private-account message';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000405', true);
do $$
declare
  request_id uuid;
begin
  select id into request_id from public.follow_requests
  where requester_id = '00000000-0000-0000-0000-000000000401'
    and target_id = auth.uid();
  if request_id is null or public.respond_to_follow_request(request_id, false) <> 'declined' then
    raise exception 'The private account could not decline its messaging follow request';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
do $$
begin
  if public.get_message_permission('00000000-0000-0000-0000-000000000405') <> 'required' then
    raise exception 'A declined request granted messaging permission';
  end if;
  begin
    perform public.open_direct_conversation('00000000-0000-0000-0000-000000000405');
    raise exception 'A declined requester opened a private-account conversation';
  exception when insufficient_privilege then null;
  end;
  if public.follow_profile('00000000-0000-0000-0000-000000000405') <> 'requested' then
    raise exception 'A declined requester could not request again';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000405', true);
do $$
declare
  request_id uuid;
begin
  select id into request_id from public.follow_requests
  where requester_id = '00000000-0000-0000-0000-000000000401'
    and target_id = auth.uid();
  if request_id is null or public.respond_to_follow_request(request_id, true) <> 'following' then
    raise exception 'The private account could not approve its follow request';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select set_config('request.headers', '{}', true);
select set_config('realtime.topic', 'call:00000000-0000-0000-0000-000000000605', true);
do $$
declare
  opened_id uuid;
begin
  if public.get_message_permission('00000000-0000-0000-0000-000000000405') <> 'allowed' then
    raise exception 'An approved follower could not message the private account';
  end if;
  opened_id := public.open_direct_conversation('00000000-0000-0000-0000-000000000405');
  if opened_id <> '00000000-0000-0000-0000-000000000605' then
    raise exception 'An approved follower could not reuse the existing conversation';
  end if;
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000615') <> 1 then
    raise exception 'An approved follower could not read retained conversation history';
  end if;
  insert into public.messages (conversation_id, sender_id, body)
  values ('00000000-0000-0000-0000-000000000605', auth.uid(), 'approved follower message');
  if (select count(*) from realtime.messages where topic = 'call:00000000-0000-0000-0000-000000000605') <> 1 then
    raise exception 'An approved follower could not access the conversation call topic';
  end if;

  insert into public.hidden_chat_preferences (user_id, conversation_id, is_hidden)
  values (auth.uid(), '00000000-0000-0000-0000-000000000605', true);
  if (select count(*) from public.messages where conversation_id = '00000000-0000-0000-0000-000000000605') <> 0 then
    raise exception 'Follow approval bypassed the existing hidden-chat lock';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.create_hidden_chat_access_grant(
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000605',
  encode(pg_catalog.sha256(decode(repeat('9', 64), 'hex')), 'hex')
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select set_config('request.headers', '{"x-panda-hidden-chat-grant":"' || repeat('9', 64) || '"}', true);
do $$
begin
  if (select count(*) from public.messages where id = '00000000-0000-0000-0000-000000000615') <> 1
     or (select count(*) from public.message_attachments where message_id = '00000000-0000-0000-0000-000000000615') <> 1
     or (select count(*) from storage.objects where name = '00000000-0000-0000-0000-000000000401/00000000-0000-0000-0000-000000000615/private-change.jpg') <> 1 then
    raise exception 'An approved follower could not access hidden conversation history and media after unlock';
  end if;
end;
$$;

rollback;
