\set ON_ERROR_STOP on

begin;

create temporary table test_results(test_name text primary key, passed boolean not null);
create temporary table invite_tokens(label text primary key, invitation_id uuid, token text);
grant select, insert on test_results to authenticated;
grant select, insert, update, delete on invite_tokens to authenticated;
create function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'FAIL: %', p_name; end if;
  insert into test_results values (p_name, true);
end
$$;

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('34000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'life-a@example.test', '{"display_name":"Life A"}', now(), now()),
  ('34000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'life-b@example.test', '{"display_name":"Life B"}', now(), now()),
  ('34000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'life-c@example.test', '{"display_name":"Life C"}', now(), now()),
  ('34000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'life-d@example.test', '{"display_name":"Life D"}', now(), now());

select pg_temp.assert_true('solo authenticated ejecuta lifecycle RPCs',
  has_function_privilege('authenticated', 'public.create_household(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_household(text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.create_household(text)', 'EXECUTE'));

set role authenticated;
select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000001', true);
create temporary table created_households(label text primary key, household_id uuid not null);
grant select, insert on created_households to authenticated;
insert into created_households values ('ab', public.create_household('Casa AB'));
select pg_temp.assert_true('create_household forma uno current y MXN', (
  select status = 'forming' and currency = 'MXN'
    from public.households
   where id = (select household_id from created_households where label = 'ab')
) and (select count(*) = 1 from public.household_members));

insert into invite_tokens
select 'accept', invitation_id, invitation_token
  from public.create_household_invitation(
    (select household_id from created_households where label = 'ab'),
    'LIFE-B@EXAMPLE.TEST'
  );
select pg_temp.assert_true('token de invitación tiene 256 bits hex',
  (select token ~ '^[0-9a-f]{64}$' from invite_tokens where label = 'accept'));

do $$ begin
  begin
    perform public.create_household('Duplicado A');
    raise exception 'second current household accepted';
  exception when unique_violation then
    insert into test_results values ('usuario no crea dos Households current', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000003', true);
do $$ begin
  begin
    perform public.accept_household_invitation((select token from invite_tokens where label = 'accept'));
    raise exception 'wrong email accepted invitation';
  exception when no_data_found then
    insert into test_results values ('email autenticado debe coincidir', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_true('accept activa exactamente dos current',
  public.accept_household_invitation((select token from invite_tokens where label = 'accept'))
    = (select household_id from created_households where label = 'ab'));
reset role;
select pg_temp.assert_true('invitación aceptada se consume una vez', (
  select invitation.status = 'accepted' from public.households household
  join public.household_invitations invitation on invitation.household_id = household.id
  where household.id = (select household_id from created_households where label = 'ab')
) and (select count(*) = 2 from public.household_members));
set role authenticated;
select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000002', true);
do $$ begin
  begin
    perform public.accept_household_invitation((select token from invite_tokens where label = 'accept'));
    raise exception 'accepted token reused';
  exception when no_data_found then
    insert into test_results values ('token accepted no se reutiliza', true);
  end;
end $$;

select public.leave_household((select household_id from created_households where label = 'ab'));
select pg_temp.assert_true('leave cierra y archiva a ambos', (
  select status = 'closed' from public.households
   where id = (select household_id from created_households where label = 'ab')
) and (
  select count(*) = 2 from public.household_members where status = 'archived'
));

select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000001', true);
insert into created_households values ('a2', public.create_household('Casa A2'));
select pg_temp.assert_true('archived libera cupo para otro Household',
  (select count(*) = 1 from public.households where status = 'forming'));
select public.leave_household((select household_id from created_households where label = 'a2'));

select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000003', true);
insert into created_households values ('cd', public.create_household('Casa CD'));
insert into invite_tokens
select 'reject', invitation_id, invitation_token
  from public.create_household_invitation(
    (select household_id from created_households where label = 'cd'), 'life-d@example.test'
  );
select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000004', true);
select public.reject_household_invitation((select token from invite_tokens where label = 'reject'));
do $$ begin
  begin
    perform public.accept_household_invitation((select token from invite_tokens where label = 'reject'));
    raise exception 'rejected token accepted';
  exception when no_data_found then
    insert into test_results values ('token rejected no acepta', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000003', true);
insert into invite_tokens
select 'revoke', invitation_id, invitation_token
  from public.create_household_invitation(
    (select household_id from created_households where label = 'cd'), 'life-d@example.test'
  );
select public.revoke_household_invitation(
  (select invitation_id from invite_tokens where label = 'revoke')
);
select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000004', true);
do $$ begin
  begin
    perform public.accept_household_invitation((select token from invite_tokens where label = 'revoke'));
    raise exception 'revoked token accepted';
  exception when no_data_found then
    insert into test_results values ('token revoked no acepta', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000003', true);
insert into invite_tokens
select 'expired', invitation_id, invitation_token
  from public.create_household_invitation(
    (select household_id from created_households where label = 'cd'), 'life-d@example.test'
  );
reset role;
update public.household_invitations
   set created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
 where id = (select invitation_id from invite_tokens where label = 'expired');
set role authenticated;
select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000004', true);
do $$ begin
  begin
    perform public.accept_household_invitation((select token from invite_tokens where label = 'expired'));
    raise exception 'expired token accepted';
  exception when no_data_found then
    insert into test_results values ('token expirado no acepta', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', '34000000-0000-4000-8000-000000000003', true);
select public.leave_household((select household_id from created_households where label = 'cd'));
reset role;
select pg_temp.assert_true('leave revoca pending restante', (
  select status = 'revoked' from public.household_invitations
   where id = (select invitation_id from invite_tokens where label = 'expired')
));

select pg_temp.assert_true('solo hash se almacena', not exists (
  select 1 from invite_tokens token_row
  join public.household_invitations invitation
    on invitation.id = token_row.invitation_id
   and encode(invitation.token_hash, 'hex') = token_row.token
));
select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;
rollback;
