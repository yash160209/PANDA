begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000811', 'authenticated', 'authenticated', 'secret-inbox-a@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"secret_inbox_a"}', now(), now()),
  ('00000000-0000-0000-0000-000000000812', 'authenticated', 'authenticated', 'secret-inbox-b@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"secret_inbox_b"}', now(), now()),
  ('00000000-0000-0000-0000-000000000813', 'authenticated', 'authenticated', 'secret-inbox-c@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"secret_inbox_c"}', now(), now()),
  ('00000000-0000-0000-0000-000000000814', 'authenticated', 'authenticated', 'secret-inbox-d@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"secret_inbox_d"}', now(), now());

insert into public.conversations (id)
values
  ('00000000-0000-0000-0000-000000000821'),
  ('00000000-0000-0000-0000-000000000822');

insert into public.conversation_participants (conversation_id, user_id)
values
  ('00000000-0000-0000-0000-000000000821', '00000000-0000-0000-0000-000000000811'),
  ('00000000-0000-0000-0000-000000000821', '00000000-0000-0000-0000-000000000812'),
  ('00000000-0000-0000-0000-000000000822', '00000000-0000-0000-0000-000000000811'),
  ('00000000-0000-0000-0000-000000000822', '00000000-0000-0000-0000-000000000813');

insert into public.messages (id, conversation_id, sender_id, body)
values
  ('00000000-0000-0000-0000-000000000831', '00000000-0000-0000-0000-000000000821', '00000000-0000-0000-0000-000000000812', 'first hidden preview'),
  ('00000000-0000-0000-0000-000000000832', '00000000-0000-0000-0000-000000000822', '00000000-0000-0000-0000-000000000813', 'second hidden preview');

insert into public.hidden_chat_preferences (user_id, conversation_id, is_hidden)
values
  ('00000000-0000-0000-0000-000000000811', '00000000-0000-0000-0000-000000000821', true),
  ('00000000-0000-0000-0000-000000000811', '00000000-0000-0000-0000-000000000822', true);

insert into public.hidden_chat_entry_credentials (user_id, salt, code_hash, iterations)
values ('00000000-0000-0000-0000-000000000811', repeat('a', 32), repeat('b', 64), 600000);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000811', true);

do $$
declare
  result_count integer;
begin
  if public.has_hidden_chat_entry_code() is distinct from true then
    raise exception 'An owner could not check that a Secret Code is configured';
  end if;

  begin
    perform count(*) from public.hidden_chat_entry_credentials;
    raise exception 'Authenticated users can read Secret Code hashes directly';
  exception when insufficient_privilege then null;
  end;

  begin
    perform count(*) from public.hidden_chat_entry_attempts;
    raise exception 'Authenticated users can read Secret Code rate-limit state directly';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.consume_hidden_chat_entry_attempt(auth.uid());
    raise exception 'Authenticated users can call the Secret Code rate-limit RPC directly';
  exception when insufficient_privilege then null;
  end;

  begin
    perform * from public.list_hidden_conversation_summaries(auth.uid());
    raise exception 'Authenticated users can directly request the privileged hidden summary listing';
  exception when insufficient_privilege then null;
  end;

  select count(*) into result_count
  from public.conversations
  where id in (
    '00000000-0000-0000-0000-000000000821',
    '00000000-0000-0000-0000-000000000822'
  );
  if result_count <> 0 then
    raise exception 'Hidden conversations were visible without a conversation grant';
  end if;

  select count(*) into result_count
  from public.messages
  where id in (
    '00000000-0000-0000-0000-000000000831',
    '00000000-0000-0000-0000-000000000832'
  );
  if result_count <> 0 then
    raise exception 'Hidden messages were visible without a conversation grant';
  end if;

  begin
    perform public.mark_conversation_messages_read('00000000-0000-0000-0000-000000000821');
    raise exception 'A locked hidden conversation marked messages as read';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  attempt_count integer;
  attempt_number integer;
begin
  for attempt_number in 1..6 loop
    attempt_count := public.consume_hidden_chat_entry_attempt(
      '00000000-0000-0000-0000-000000000811'
    );
    if attempt_count <> attempt_number then
      raise exception 'The Secret Code attempt counter did not increment atomically';
    end if;
  end loop;
end;
$$;

do $$
declare
  result_count integer;
  unread_total bigint;
  listing_expiry timestamptz;
  conversation_expiry timestamptz;
begin
  select count(*), sum(summary.unread_count)
  into result_count, unread_total
  from public.list_hidden_conversation_summaries('00000000-0000-0000-0000-000000000811') summary;
  if result_count <> 2 or unread_total <> 2 then
    raise exception 'The authorized Hidden Inbox summary did not contain both conversations and unread counts';
  end if;

  select public.create_hidden_chat_access_grant(
    '00000000-0000-0000-0000-000000000811',
    null,
    encode(pg_catalog.sha256(pg_catalog.decode(repeat('c', 64), 'hex')), 'hex')
  ) into listing_expiry;

  select public.create_hidden_chat_access_grant(
    '00000000-0000-0000-0000-000000000811',
    '00000000-0000-0000-0000-000000000821',
    encode(pg_catalog.sha256(pg_catalog.decode(repeat('d', 64), 'hex')), 'hex')
  ) into conversation_expiry;

  if conversation_expiry > listing_expiry then
    raise exception 'A conversation unlock outlived its Secret Code listing grant';
  end if;

  begin
    perform public.create_hidden_chat_access_grant(
      '00000000-0000-0000-0000-000000000814',
      '00000000-0000-0000-0000-000000000821',
      repeat('e', 64)
    );
    raise exception 'A grant was created for a user outside the conversation';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000814', true);
select set_config('request.headers', '{}', true);

do $$
declare
  result_count integer;
  affected_count integer;
begin
  if public.has_hidden_chat_entry_code() is distinct from false then
    raise exception 'Secret Code status leaked across authenticated users';
  end if;

  select count(*) into result_count
  from public.conversations
  where id = '00000000-0000-0000-0000-000000000821';
  if result_count <> 0 then
    raise exception 'An unrelated user read another user''s hidden conversation';
  end if;

  select count(*) into result_count
  from public.hidden_chat_preferences
  where user_id = '00000000-0000-0000-0000-000000000811';
  if result_count <> 0 then
    raise exception 'An unrelated user read another user''s hidden preferences';
  end if;

  update public.hidden_chat_preferences
  set is_hidden = false
  where user_id = '00000000-0000-0000-0000-000000000811';
  get diagnostics affected_count = row_count;
  if affected_count <> 0 then
    raise exception 'An unrelated user altered another user''s hidden preferences';
  end if;

  delete from public.hidden_chat_preferences
  where user_id = '00000000-0000-0000-0000-000000000811';
  get diagnostics affected_count = row_count;
  if affected_count <> 0 then
    raise exception 'An unrelated user deleted another user''s hidden preferences';
  end if;

  begin
    insert into public.hidden_chat_preferences (user_id, conversation_id, is_hidden)
    values (auth.uid(), '00000000-0000-0000-0000-000000000821', true);
    raise exception 'An unrelated user inserted a hidden preference for another conversation';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000811', true);
select set_config(
  'request.headers',
  '{"x-panda-hidden-chat-grant":"' || repeat('c', 64) || '"}',
  true
);

do $$
declare
  result_count integer;
begin
  if public.can_access_hidden_conversation('00000000-0000-0000-0000-000000000821') then
    raise exception 'A listing grant unlocked a conversation';
  end if;

  select count(*) into result_count
  from public.messages
  where id = '00000000-0000-0000-0000-000000000831';
  if result_count <> 0 then
    raise exception 'A listing grant exposed hidden messages';
  end if;
end;
$$;

select set_config(
  'request.headers',
  '{"x-panda-hidden-chat-grant":"' || repeat('d', 64) || '"}',
  true
);

do $$
declare
  result_count integer;
  marked_count integer;
  read_timestamp timestamptz;
begin
  if not public.can_access_hidden_conversation('00000000-0000-0000-0000-000000000821') then
    raise exception 'A valid conversation grant was rejected';
  end if;

  select count(*) into result_count
  from public.messages
  where id = '00000000-0000-0000-0000-000000000831';
  if result_count <> 1 then
    raise exception 'A valid conversation grant did not expose its hidden message';
  end if;

  if public.can_access_hidden_conversation('00000000-0000-0000-0000-000000000822') then
    raise exception 'A conversation grant unlocked a different hidden conversation';
  end if;

  marked_count := public.mark_conversation_messages_read('00000000-0000-0000-0000-000000000821');
  select read_at into read_timestamp
  from public.messages
  where id = '00000000-0000-0000-0000-000000000831';
  if marked_count <> 1 or read_timestamp is null then
    raise exception 'Opening an authorized hidden conversation did not mark its incoming message read';
  end if;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.save_hidden_chat_entry_credential(
  '00000000-0000-0000-0000-000000000811',
  repeat('f', 32),
  repeat('e', 64),
  600000
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000811', true);
select set_config(
  'request.headers',
  '{"x-panda-hidden-chat-grant":"' || repeat('d', 64) || '"}',
  true
);

do $$
begin
  if public.can_access_hidden_conversation('00000000-0000-0000-0000-000000000821') then
    raise exception 'Changing a Secret Code did not invalidate existing conversation grants';
  end if;
end;
$$;

rollback;
