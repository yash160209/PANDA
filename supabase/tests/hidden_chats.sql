begin;

do $$
declare
  conversation_id uuid := '00000000-0000-0000-0000-000000000201';
  unrelated_conversation_id uuid := '00000000-0000-0000-0000-000000000203';
  message_id uuid := '00000000-0000-0000-0000-000000000202';
  grant_token text := repeat('a', 64);
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000211', 'authenticated', 'authenticated', 'hidden-test-a@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"hidden_test_a"}', now(), now()),
    ('00000000-0000-0000-0000-000000000212', 'authenticated', 'authenticated', 'hidden-test-b@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"hidden_test_b"}', now(), now()),
    ('00000000-0000-0000-0000-000000000213', 'authenticated', 'authenticated', 'hidden-test-c@users.panda.invalid', '{"provider":"email","providers":["email"]}', '{"username":"hidden_test_c"}', now(), now());

  insert into public.conversations (id) values (conversation_id);
  insert into public.conversations (id) values (unrelated_conversation_id);
  insert into public.conversation_participants (conversation_id, user_id)
  values
    (conversation_id, '00000000-0000-0000-0000-000000000211'),
    (conversation_id, '00000000-0000-0000-0000-000000000212'),
    (unrelated_conversation_id, '00000000-0000-0000-0000-000000000213');
  insert into public.messages (id, conversation_id, sender_id, body)
  values (message_id, conversation_id, '00000000-0000-0000-0000-000000000212', 'hidden fixture message');
  insert into public.hidden_chat_pin_credentials (user_id, salt, pin_hash, iterations)
  values (
    '00000000-0000-0000-0000-000000000211',
    repeat('b', 32),
    repeat('c', 64),
    600000
  );
  insert into public.hidden_chat_preferences (user_id, conversation_id, is_hidden)
  values ('00000000-0000-0000-0000-000000000211', conversation_id, false);

  insert into public.hidden_chat_access_grants (
    token_hash,
    user_id,
    expires_at,
    conversation_id,
    grant_scope
  )
  values (
    encode(pg_catalog.sha256(decode(grant_token, 'hex')), 'hex'),
    '00000000-0000-0000-0000-000000000211',
    now() - interval '1 minute',
    conversation_id,
    'conversation'
  );
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000211', true);
select set_config(
  'request.headers',
  '{"x-panda-hidden-chat-grant":"' || repeat('a', 64) || '"}',
  true
);

do $$
declare
  result_count integer;
begin
  select count(*) into result_count
  from public.conversations
  where id = '00000000-0000-0000-0000-000000000201';
  if result_count <> 1 then
    raise exception 'A visible participant conversation was not readable';
  end if;

  update public.hidden_chat_preferences
  set is_hidden = true
  where user_id = auth.uid()
    and conversation_id = '00000000-0000-0000-0000-000000000201';
  get diagnostics result_count = row_count;
  if result_count <> 1 then
    raise exception 'A participant could not hide their conversation';
  end if;

  select count(*) into result_count
  from public.conversations
  where id = '00000000-0000-0000-0000-000000000201';
  if result_count <> 0 then
    raise exception 'A hidden conversation was readable without a grant';
  end if;

  select count(*) into result_count
  from public.messages
  where id = '00000000-0000-0000-0000-000000000202';
  if result_count <> 0 then
    raise exception 'A hidden message was readable without a grant';
  end if;

  select count(*) into result_count
  from public.conversation_participants
  where conversation_id = '00000000-0000-0000-0000-000000000201';
  if result_count <> 0 then
    raise exception 'Hidden conversation participants were readable without a grant';
  end if;

  if public.can_access_hidden_conversation('00000000-0000-0000-0000-000000000201') then
    raise exception 'An expired grant was accepted';
  end if;

  update public.hidden_chat_preferences
  set is_hidden = false
  where user_id = auth.uid()
    and conversation_id = '00000000-0000-0000-0000-000000000201';
  get diagnostics result_count = row_count;
  if result_count <> 0 then
    raise exception 'A hidden conversation was unhidden with an expired grant';
  end if;

  delete from public.hidden_chat_preferences
  where user_id = auth.uid()
    and conversation_id = '00000000-0000-0000-0000-000000000201';
  get diagnostics result_count = row_count;
  if result_count <> 0 then
    raise exception 'A hidden preference was deleted without a valid PIN grant';
  end if;

  begin
    perform public.create_hidden_chat_access_grant(
      auth.uid(),
      '00000000-0000-0000-0000-000000000201',
      repeat('d', 64)
    );
    raise exception 'An authenticated user created a verification grant';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.hidden_chat_pin_credentials (user_id, salt, pin_hash, iterations)
    values (auth.uid(), repeat('d', 32), repeat('e', 64), 600000);
    raise exception 'An authenticated user wrote a PIN credential directly';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.hidden_chat_preferences (user_id, conversation_id, is_hidden)
    values (auth.uid(), '00000000-0000-0000-0000-000000000203', true);
    raise exception 'A non-participant changed a chat preference';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000212', true);
select set_config('request.headers', '{}', true);

do $$
declare
  result_count integer;
begin
  select count(*) into result_count
  from public.conversations
  where id = '00000000-0000-0000-0000-000000000201';
  if result_count <> 1 then
    raise exception 'One participant hiding a chat blocked another participant';
  end if;

  begin
    insert into public.hidden_chat_preferences (user_id, conversation_id, is_hidden)
    values (auth.uid(), '00000000-0000-0000-0000-000000000201', true);
    raise exception 'A participant without a PIN hid a conversation';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
update public.hidden_chat_access_grants
set expires_at = now() + interval '5 minutes'
where user_id = '00000000-0000-0000-0000-000000000211';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000211', true);
select set_config(
  'request.headers',
  '{"x-panda-hidden-chat-grant":"' || repeat('a', 64) || '"}',
  true
);

do $$
declare
  result_count integer;
begin
  if not public.can_access_hidden_conversation('00000000-0000-0000-0000-000000000201') then
    raise exception 'A valid grant for a participant was rejected';
  end if;

  select count(*) into result_count
  from public.conversations
  where id = '00000000-0000-0000-0000-000000000201';
  if result_count <> 1 then
    raise exception 'A valid grant did not unlock the hidden conversation';
  end if;

  select count(*) into result_count
  from public.messages
  where id = '00000000-0000-0000-0000-000000000202';
  if result_count <> 1 then
    raise exception 'A valid grant did not unlock hidden messages';
  end if;

  update public.hidden_chat_preferences
  set is_hidden = false
  where user_id = auth.uid()
    and conversation_id = '00000000-0000-0000-0000-000000000201';
  get diagnostics result_count = row_count;
  if result_count <> 1 then
    raise exception 'A participant could not unhide their conversation';
  end if;

  perform set_config('request.headers', '{}', true);
  select count(*) into result_count
  from public.conversations
  where id = '00000000-0000-0000-0000-000000000201';
  if result_count <> 1 then
    raise exception 'An unhidden conversation remained inaccessible in the normal inbox';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

do $$
declare
  attempt_count integer;
  index integer;
begin
  for index in 1..6 loop
    attempt_count := public.consume_hidden_chat_pin_attempt('00000000-0000-0000-0000-000000000211');
  end loop;
  if attempt_count <> 6 then
    raise exception 'PIN attempt counter did not include concurrent-threshold attempts';
  end if;
end;
$$;

rollback;
