begin;

do $$
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (
    '00000000-0000-0000-0000-000000000101',
    'authenticated',
    'authenticated',
    'reservation-test-a@users.panda.invalid',
    '{"provider":"email","providers":["email"]}',
    '{"username":"Yash","display_name":"Reservation Test A"}',
    now(),
    now()
  );
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (
    '00000000-0000-0000-0000-000000000102',
    'authenticated',
    'authenticated',
    'reservation-test-b@users.panda.invalid',
    '{"provider":"email","providers":["email"]}',
    '{"username":"other_user","display_name":"Reservation Test B"}',
    now(),
    now()
  );

  if (select username from public.profiles where id = '00000000-0000-0000-0000-000000000101') is distinct from 'yash' then
    raise exception 'Username trigger did not normalize case';
  end if;

  if public.is_username_available('YASH') then
    raise exception 'Availability check accepted a claimed username with different casing';
  end if;

  if not public.is_username_available('available_name') then
    raise exception 'Availability check rejected an unclaimed username';
  end if;

  begin
    insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      '00000000-0000-0000-0000-000000000103',
      'authenticated',
      'authenticated',
      'reservation-test-duplicate@users.panda.invalid',
      '{"provider":"email","providers":["email"]}',
      '{"username":"yash","display_name":"Duplicate"}',
      now(),
      now()
    );
    raise exception 'Case-insensitive duplicate username was accepted';
  exception
    when unique_violation then null;
  end;

  update public.profiles
  set username = 'new_yash_name'
  where id = '00000000-0000-0000-0000-000000000101';

  if not exists (
    select 1 from public.username_reservations
    where username = 'yash' and owner_id = '00000000-0000-0000-0000-000000000101'
  ) then
    raise exception 'Old username was not retained after a rename';
  end if;

  begin
    insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      '00000000-0000-0000-0000-000000000104',
      'authenticated',
      'authenticated',
      'reservation-test-old-name@users.panda.invalid',
      '{"provider":"email","providers":["email"]}',
      '{"username":"YASH","display_name":"Old Name Claim"}',
      now(),
      now()
    );
    raise exception 'Previously claimed username was accepted';
  exception
    when unique_violation then null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);

do $$
declare
  changed_rows integer;
begin
  if not public.is_username_available('OTHER_USER') then
    raise exception 'Availability check rejected the current owner username';
  end if;

  if public.is_username_available('YASH') then
    raise exception 'Availability check allowed a different user to claim a reserved username';
  end if;

  update public.profiles
  set username = 'stolen_name'
  where id = '00000000-0000-0000-0000-000000000101';
  get diagnostics changed_rows = row_count;

  if changed_rows <> 0 then
    raise exception 'A user modified another user profile';
  end if;

  begin
    insert into public.username_reservations (username, owner_id)
    values ('unauthorized_name', '00000000-0000-0000-0000-000000000102');
    raise exception 'A user wrote directly to the reservation table';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
begin
  delete from auth.users
  where id = '00000000-0000-0000-0000-000000000101';

  if exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000101') then
    raise exception 'Test account profile was not deleted';
  end if;

  if not exists (
    select 1 from public.username_reservations
    where username = 'yash' and owner_id = '00000000-0000-0000-0000-000000000101'
  ) then
    raise exception 'Username reservation did not survive account deletion';
  end if;

  begin
    insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (
      '00000000-0000-0000-0000-000000000105',
      'authenticated',
      'authenticated',
      'reservation-test-deleted-name@users.panda.invalid',
      '{"provider":"email","providers":["email"]}',
      '{"username":"yash","display_name":"Deleted Name Claim"}',
      now(),
      now()
    );
    raise exception 'Deleted account username was made available again';
  exception
    when unique_violation then null;
  end;
end;
$$;

rollback;
