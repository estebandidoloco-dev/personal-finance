begin;

create function public.get_household_expense_detail(p_expense_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  expense_row public.household_expenses%rowtype;
  source_account_id uuid;
  source_amount numeric;
  source_currency text;
  source_date date;
  source_description text;
  source_notes text;
  source_status text;
  split_payload jsonb;
  split_count integer;
  split_total numeric;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select expense.*
    into expense_row
    from public.household_expenses expense
    join public.households household
      on household.id = expense.household_id
    join public.household_members member_row
      on member_row.household_id = household.id
     and member_row.user_id = actor_id
   where expense.id = p_expense_id
     and (
       (household.status = 'active' and member_row.status = 'current')
       or (household.status = 'closed' and member_row.status = 'archived')
     );

  if not found then
    raise exception 'Household expense does not exist or is unavailable'
      using errcode = 'P0002';
  end if;

  if expense_row.funding_source = 'personal_account' then
    select transaction_row.account_id,
           transaction_row.amount,
           transaction_row.currency,
           transaction_row.date,
           transaction_row.description,
           case when actor_id = expense_row.personal_payer_user_id
                then transaction_row.notes else null end,
           transaction_row.status
      into source_account_id, source_amount, source_currency, source_date,
           source_description, source_notes, source_status
      from public.transactions transaction_row
     where transaction_row.id = expense_row.personal_transaction_id
       and transaction_row.user_id = expense_row.personal_payer_user_id
       and transaction_row.kind = 'expense'::public.transaction_kind
       and transaction_row.currency = 'MXN';
  else
    select transaction_row.account_id,
           transaction_row.amount,
           transaction_row.currency,
           transaction_row.date,
           transaction_row.description,
           transaction_row.notes,
           transaction_row.status
      into source_account_id, source_amount, source_currency, source_date,
           source_description, source_notes, source_status
      from public.household_account_transactions transaction_row
      join public.household_accounts account
        on account.id = transaction_row.account_id
       and account.household_id = transaction_row.household_id
     where transaction_row.id = expense_row.household_account_transaction_id
       and transaction_row.household_id = expense_row.household_id
       and transaction_row.kind = 'expense'::public.transaction_kind
       and transaction_row.currency = 'MXN'
       and account.currency = 'MXN';
  end if;

  if not found then
    raise exception 'Household expense has an incoherent source' using errcode = 'P0001';
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'user_id', split.user_id,
             'amount', private.format_exact_money(split.amount)
           ) order by split.user_id
         ),
         count(*),
         coalesce(sum(split.amount), 0)
    into split_payload, split_count, split_total
    from public.household_expense_splits split
   where split.household_expense_id = expense_row.id;

  if split_count <> 2 or split_total is distinct from source_amount then
    raise exception 'Household expense has incoherent splits' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'id', expense_row.id,
    'household_id', expense_row.household_id,
    'funding_source', expense_row.funding_source,
    'source_account_id', case
      when expense_row.funding_source = 'personal_account'
           and actor_id <> expense_row.personal_payer_user_id then null
      else source_account_id
    end,
    'personal_payer_user_id', expense_row.personal_payer_user_id,
    'recorded_by_user_id', expense_row.recorded_by_user_id,
    'split_mode', expense_row.split_mode,
    'category_id', expense_row.category_id,
    'amount', private.format_exact_money(source_amount),
    'currency', source_currency,
    'date', source_date,
    'description', source_description,
    'notes', source_notes,
    'status', source_status,
    'splits', split_payload,
    'created_at', expense_row.created_at,
    'updated_at', expense_row.updated_at
  );
end
$$;

alter function public.get_household_expense_detail(uuid) owner to postgres;
revoke all on function public.get_household_expense_detail(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_household_expense_detail(uuid) to authenticated;

commit;
