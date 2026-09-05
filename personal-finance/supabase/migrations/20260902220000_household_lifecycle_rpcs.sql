-- P1.4 phase 3: atomic Household lifecycle and invitation RPCs.

begin;

create function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  household_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform 1 from public.profiles where id = actor_id for update;
  if not found then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if exists (
    select 1 from public.household_members
     where user_id = actor_id and status = 'current'
  ) then
    raise exception 'User already has a current Household membership'
      using errcode = '23505';
  end if;

  insert into public.households(name, currency, status, created_by_user_id)
  values (p_name, 'MXN', 'forming', actor_id)
  returning id into household_id;
  insert into public.household_members(household_id, user_id)
  values (household_id, actor_id);
  return household_id;
end
$$;

create function public.create_household_invitation(
  p_household_id uuid,
  p_invited_email text
)
returns table(invitation_id uuid, invitation_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  normalized_email text := lower(btrim(p_invited_email));
  raw_token bytea;
  new_invitation_id uuid;
  new_expires_at timestamptz := now() + interval '7 days';
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select lower(btrim(users.email)) into actor_email
    from auth.users users where users.id = actor_id;
  if actor_email is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if normalized_email = actor_email then
    raise exception 'Cannot invite the authenticated user' using errcode = '22023';
  end if;

  perform 1 from public.households household
   where household.id = p_household_id
   for update;
  if not found or not exists (
    select 1 from public.households household
    join public.household_members member_row on member_row.household_id = household.id
     where household.id = p_household_id
       and household.status = 'forming'
       and member_row.user_id = actor_id
       and member_row.status = 'current'
  ) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;

  update public.household_invitations invitation
     set status = 'expired', resolved_at = now()
   where invitation.household_id = p_household_id
     and invitation.status = 'pending'
     and invitation.expires_at <= now();

  raw_token := extensions.gen_random_bytes(32);
  insert into public.household_invitations(
    household_id, invited_by_user_id, invited_email, token_hash, expires_at
  ) values (
    p_household_id, actor_id, normalized_email,
    extensions.digest(raw_token, 'sha256'), new_expires_at
  ) returning id into new_invitation_id;

  return query select new_invitation_id, encode(raw_token, 'hex'), new_expires_at;
end
$$;

create function public.revoke_household_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_household_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select invitation.household_id into target_household_id
    from public.household_invitations invitation
   where invitation.id = p_invitation_id;
  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  perform 1 from public.households household
   where household.id = target_household_id for update;
  if not exists (
    select 1 from public.household_members member_row
    join public.households household on household.id = member_row.household_id
     where member_row.household_id = target_household_id
       and member_row.user_id = actor_id
       and member_row.status = 'current'
       and household.status = 'forming'
  ) then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  perform 1 from public.household_invitations invitation
   where invitation.id = p_invitation_id
     and invitation.household_id = target_household_id
     and invitation.status = 'pending'
   for update;
  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  update public.household_invitations
     set status = 'revoked', resolved_at = now()
   where id = p_invitation_id;
end
$$;

create function public.accept_household_invitation(p_invitation_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  candidate_hash bytea;
  target_household_id uuid;
  invitation_status text;
  invitation_email text;
  invitation_expiry timestamptz;
  household_status text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_invitation_token is null or p_invitation_token !~ '^[0-9A-Fa-f]{64}$' then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  candidate_hash := extensions.digest(decode(lower(p_invitation_token), 'hex'), 'sha256');

  select invitation.household_id into target_household_id
    from public.household_invitations invitation
   where invitation.token_hash = candidate_hash;
  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  perform 1 from public.households household
   where household.id = target_household_id for update;
  select invitation.status, invitation.invited_email, invitation.expires_at
    into invitation_status, invitation_email, invitation_expiry
    from public.household_invitations invitation
   where invitation.token_hash = candidate_hash
     and invitation.household_id = target_household_id
   for update;
  select household.status into household_status
    from public.households household where household.id = target_household_id;

  select lower(btrim(users.email)) into actor_email
    from auth.users users where users.id = actor_id;
  if actor_email is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform 1 from public.profiles where id = actor_id for update;

  if invitation_status <> 'pending'
     or invitation_expiry <= now()
     or invitation_email <> actor_email
     or household_status <> 'forming' then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.household_members
     where user_id = actor_id and status = 'current'
  ) then
    raise exception 'User already has a current Household membership'
      using errcode = '23505';
  end if;
  if (select count(*) from public.household_members
       where household_id = target_household_id and status = 'current') <> 1 then
    raise exception 'Household is not accepting members' using errcode = '23514';
  end if;

  insert into public.household_members(household_id, user_id)
  values (target_household_id, actor_id);
  update public.household_invitations
     set status = 'accepted', resolved_at = now()
   where token_hash = candidate_hash;
  update public.households
     set status = 'active', activated_at = now()
   where id = target_household_id;
  return target_household_id;
end
$$;

create function public.reject_household_invitation(p_invitation_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  candidate_hash bytea;
  target_household_id uuid;
  invitation_email text;
  invitation_expiry timestamptz;
  invitation_status text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_invitation_token is null or p_invitation_token !~ '^[0-9A-Fa-f]{64}$' then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  candidate_hash := extensions.digest(decode(lower(p_invitation_token), 'hex'), 'sha256');
  select invitation.household_id into target_household_id
    from public.household_invitations invitation
   where invitation.token_hash = candidate_hash;
  if not found then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  perform 1 from public.households household
   where household.id = target_household_id for update;
  select invitation.invited_email, invitation.expires_at, invitation.status
    into invitation_email, invitation_expiry, invitation_status
    from public.household_invitations invitation
   where invitation.token_hash = candidate_hash
   for update;
  select lower(btrim(users.email)) into actor_email
    from auth.users users where users.id = actor_id;
  if actor_email is null
     or invitation_status <> 'pending'
     or invitation_email <> actor_email
     or invitation_expiry <= now() then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  update public.household_invitations
     set status = 'rejected', resolved_at = now()
   where token_hash = candidate_hash;
end
$$;

create function public.leave_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform 1 from public.households household
   where household.id = p_household_id for update;
  if not found or not exists (
    select 1 from public.household_members member_row
     where member_row.household_id = p_household_id
       and member_row.user_id = actor_id
       and member_row.status = 'current'
  ) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;

  update public.households
     set status = 'closed', closed_at = now()
   where id = p_household_id and status in ('forming', 'active');
  if not found then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;
  update public.household_members
     set status = 'archived', ended_at = now()
   where household_id = p_household_id and status = 'current';
  update public.household_invitations
     set status = 'revoked', resolved_at = now()
   where household_id = p_household_id and status = 'pending';
end
$$;

alter function public.create_household(text) owner to postgres;
alter function public.create_household_invitation(uuid, text) owner to postgres;
alter function public.revoke_household_invitation(uuid) owner to postgres;
alter function public.accept_household_invitation(text) owner to postgres;
alter function public.reject_household_invitation(text) owner to postgres;
alter function public.leave_household(uuid) owner to postgres;

revoke all on function public.create_household(text) from public, anon, authenticated, service_role;
revoke all on function public.create_household_invitation(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.revoke_household_invitation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.accept_household_invitation(text) from public, anon, authenticated, service_role;
revoke all on function public.reject_household_invitation(text) from public, anon, authenticated, service_role;
revoke all on function public.leave_household(uuid) from public, anon, authenticated, service_role;

grant execute on function public.create_household(text) to authenticated;
grant execute on function public.create_household_invitation(uuid, text) to authenticated;
grant execute on function public.revoke_household_invitation(uuid) to authenticated;
grant execute on function public.accept_household_invitation(text) to authenticated;
grant execute on function public.reject_household_invitation(text) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;

commit;
