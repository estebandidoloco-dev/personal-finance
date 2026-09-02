-- CSV imports: deterministic file/external-id deduplication and batched ledger writes.
-- Reuses the P0.2 accounting primitive and its mandatory balance trigger.

alter table public.csv_imports rename column filename to file_name;

alter table public.csv_imports
  add column file_hash text,
  add column rows_duplicate integer not null default 0,
  add column rows_invalid integer not null default 0,
  add column rows_failed integer not null default 0,
  add column status text not null default 'processing',
  add column metadata jsonb not null default '{}'::jsonb,
  add column completed_at timestamptz,
  add column updated_at timestamptz not null default now();

-- Preserve legacy audit rows without pretending their original bytes are available.
update public.csv_imports
   set file_hash = encode(extensions.digest('legacy:' || id::text, 'sha256'), 'hex'),
       rows_invalid = rows_skipped,
       status = 'completed',
       completed_at = coalesce(created_at, now()),
       updated_at = coalesce(created_at, now());

alter table public.csv_imports
  alter column file_hash set not null,
  alter column rows_imported set default 0,
  alter column rows_skipped set default 0,
  add constraint csv_imports_file_name_length_check
    check (char_length(file_name) between 1 and 255),
  add constraint csv_imports_file_hash_check
    check (file_hash ~ '^[0-9a-f]{64}$'),
  add constraint csv_imports_status_check
    check (status in ('processing', 'completed', 'partial', 'failed')),
  add constraint csv_imports_nonnegative_counts_check
    check (
      rows_total >= 0 and rows_imported >= 0 and rows_skipped >= 0
      and rows_duplicate >= 0 and rows_invalid >= 0 and rows_failed >= 0
    ),
  add constraint csv_imports_skipped_breakdown_check
    check (rows_skipped = rows_duplicate + rows_invalid + rows_failed),
  add constraint csv_imports_processed_rows_check
    check (rows_imported + rows_skipped <= rows_total),
  add constraint csv_imports_metadata_object_check
    check (jsonb_typeof(metadata) = 'object');

create unique index csv_imports_active_file_unique
  on public.csv_imports(user_id, account_id, file_hash)
  where status in ('processing', 'completed', 'partial');

alter table public.transactions
  add column csv_import_id uuid references public.csv_imports(id) on delete set null,
  add column source_provider text,
  add column import_match_hash text,
  add constraint transactions_external_id_length_check
    check (external_id is null or char_length(external_id) between 1 and 200),
  add constraint transactions_source_provider_check
    check (source_provider is null or char_length(source_provider) between 1 and 100),
  add constraint transactions_csv_import_context_check
    check (
      source <> 'csv'
      or (
        csv_import_id is not null
        and import_match_hash is not null
        and (external_id is null or source_provider is not null)
      )
    ) not valid;

create index transactions_csv_import_id_idx
  on public.transactions(csv_import_id)
  where csv_import_id is not null;

create index transactions_csv_match_lookup_idx
  on public.transactions(user_id, account_id, import_match_hash)
  where source = 'csv';

create unique index transactions_csv_external_identity_unique
  on public.transactions(user_id, account_id, source, source_provider, external_id)
  where source = 'csv' and external_id is not null;

create function public.csv_import_match_hash(
  p_date date,
  p_description text,
  p_amount numeric,
  p_kind public.transaction_kind
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        'v1|' || p_date::text || '|'
        || lower(regexp_replace(btrim(p_description), '[[:space:]]+', ' ', 'g')) || '|'
        || trim(to_char(p_amount, 'FM999999999999990.00')) || '|'
        || p_kind::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function public.csv_import_match_hash(
  date, text, numeric, public.transaction_kind
) from public, anon, authenticated, service_role;
grant execute on function public.csv_import_match_hash(
  date, text, numeric, public.transaction_kind
) to authenticated;

create function private.prepare_csv_transaction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'csv' then
    new.external_id := nullif(lower(regexp_replace(btrim(new.external_id), '[[:space:]]+', ' ', 'g')), '');
    new.source_provider := nullif(lower(regexp_replace(btrim(new.source_provider), '[[:space:]]+', '-', 'g')), '');

    if new.external_id is not null and new.source_provider is null then
      new.source_provider := 'generic';
    end if;

    new.import_match_hash := public.csv_import_match_hash(
      new.date, new.description, new.amount, new.kind
    );
  else
    new.csv_import_id := null;
    new.source_provider := null;
    new.import_match_hash := null;
  end if;

  return new;
end
$$;

revoke all on function private.prepare_csv_transaction()
  from public, anon, authenticated, service_role;

create trigger transactions_prepare_csv_import
  before insert or update of source, external_id, source_provider, date, description, amount, kind
  on public.transactions
  for each row execute function private.prepare_csv_transaction();

-- Extended P0.2 primitive. The original signature below remains callable and delegates here.
create function private.create_financial_transaction_core(
  p_user_id uuid,
  p_account_id uuid,
  p_kind public.transaction_kind,
  p_amount numeric,
  p_currency text,
  p_date date,
  p_description text,
  p_category_id uuid,
  p_notes text,
  p_is_shared boolean,
  p_split_ratio jsonb,
  p_status text,
  p_source text,
  p_external_id text,
  p_tag_ids uuid[],
  p_csv_import_id uuid,
  p_source_provider text
)
returns public.transactions
language plpgsql
set search_path = ''
as $$
declare
  created_transaction public.transactions;
begin
  perform private.validate_financial_resources(
    p_user_id, p_account_id, p_category_id, p_currency
  );

  if p_source = 'csv' then
    if p_csv_import_id is null or not exists (
      select 1
      from public.csv_imports import_row
      where import_row.id = p_csv_import_id
        and import_row.user_id = p_user_id
        and import_row.account_id = p_account_id
        and import_row.status = 'processing'
    ) then
      raise exception 'Active CSV import not found'
        using errcode = 'P0002';
    end if;
  elsif p_csv_import_id is not null or p_source_provider is not null then
    raise exception 'CSV context is only valid for CSV transactions'
      using errcode = '23514';
  end if;

  insert into public.transactions(
    user_id, account_id, category_id, kind, amount, currency, date,
    description, notes, is_shared, split_ratio, status, source, external_id,
    csv_import_id, source_provider
  ) values (
    p_user_id, p_account_id, p_category_id, p_kind, p_amount, p_currency, p_date,
    p_description, p_notes, p_is_shared, p_split_ratio, p_status, p_source, p_external_id,
    p_csv_import_id, p_source_provider
  )
  returning * into created_transaction;

  perform private.replace_transaction_tags(created_transaction.id, p_user_id, p_tag_ids);
  return created_transaction;
end
$$;

revoke all on function private.create_financial_transaction_core(
  uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text,
  boolean, jsonb, text, text, text, uuid[], uuid, text
) from public, anon, authenticated, service_role;

create or replace function private.create_financial_transaction_core(
  p_user_id uuid,
  p_account_id uuid,
  p_kind public.transaction_kind,
  p_amount numeric,
  p_currency text,
  p_date date,
  p_description text,
  p_category_id uuid,
  p_notes text,
  p_is_shared boolean,
  p_split_ratio jsonb,
  p_status text,
  p_source text,
  p_external_id text,
  p_tag_ids uuid[]
)
returns public.transactions
language plpgsql
set search_path = ''
as $$
begin
  return private.create_financial_transaction_core(
    p_user_id, p_account_id, p_kind, p_amount, p_currency, p_date,
    p_description, p_category_id, p_notes, p_is_shared, p_split_ratio,
    p_status, p_source, p_external_id, p_tag_ids, null, null
  );
end
$$;

revoke all on function private.create_financial_transaction_core(
  uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text,
  boolean, jsonb, text, text, text, uuid[]
) from public, anon, authenticated, service_role;

-- Preview is deliberately SECURITY INVOKER. Existing transaction RLS limits every lookup.
create function public.preview_csv_import_rows(
  p_account_id uuid,
  p_source_provider text,
  p_rows jsonb
)
returns table (
  row_number integer,
  strong_duplicate boolean,
  possible_duplicate boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Preview must contain an array of at most 1000 rows'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.accounts account
    where account.id = p_account_id and account.user_id = auth.uid()
  ) then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  return query
  with parsed as (
    select
      (item.value->>'row_number')::integer as csv_row_number,
      nullif(lower(regexp_replace(btrim(item.value->>'external_id'), '[[:space:]]+', ' ', 'g')), '') as external_id,
      public.csv_import_match_hash(
        (item.value->>'date')::date,
        item.value->>'description',
        (item.value->>'amount')::numeric,
        (item.value->>'kind')::public.transaction_kind
      ) as match_hash
    from jsonb_array_elements(p_rows) item(value)
  ), classified as (
    select
      parsed.*,
      exists (
        select 1 from public.transactions transaction_row
        where transaction_row.user_id = auth.uid()
          and transaction_row.account_id = p_account_id
          and transaction_row.source = 'csv'
          and transaction_row.source_provider = coalesce(
            nullif(lower(regexp_replace(btrim(p_source_provider), '[[:space:]]+', '-', 'g')), ''),
            'generic'
          )
          and transaction_row.external_id = parsed.external_id
          and parsed.external_id is not null
      ) as is_strong_duplicate,
      exists (
        select 1 from public.transactions transaction_row
        where transaction_row.user_id = auth.uid()
          and transaction_row.account_id = p_account_id
          and transaction_row.source = 'csv'
          and transaction_row.import_match_hash = parsed.match_hash
      ) as matches_existing,
      count(*) over (partition by parsed.match_hash) > 1 as matches_current_file
    from parsed
  )
  select
    classified.csv_row_number,
    classified.is_strong_duplicate,
    not classified.is_strong_duplicate
      and (classified.matches_existing or classified.matches_current_file)
  from classified
  order by classified.csv_row_number;
end
$$;

revoke all on function public.preview_csv_import_rows(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_csv_import_rows(uuid, text, jsonb)
  to authenticated;

create function public.import_csv_transactions_batch(
  p_import_id uuid,
  p_category_id uuid,
  p_rows jsonb
)
returns table (
  row_number integer,
  result_status text,
  transaction_id uuid,
  error_code text,
  error_message text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
  import_row public.csv_imports;
  account_currency text;
  source_provider text;
  row_item jsonb;
  current_row_number integer;
  transaction_date date;
  current_kind public.transaction_kind;
  current_amount numeric;
  current_description text;
  current_notes text;
  current_external_id text;
  created_transaction public.transactions;
  imported_count integer := 0;
  duplicate_count integer := 0;
  invalid_count integer := 0;
  failed_count integer := 0;
  violated_constraint text;
begin
  if authenticated_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0
     or jsonb_array_length(p_rows) > 100 then
    raise exception 'Batch must contain between 1 and 100 rows'
      using errcode = '22023';
  end if;

  select import_record.*
    into import_row
    from public.csv_imports import_record
   where import_record.id = p_import_id
     and import_record.user_id = authenticated_user_id
     and import_record.status = 'processing'
   for update;

  if not found then
    raise exception 'Active CSV import not found' using errcode = 'P0002';
  end if;

  select account.currency
    into account_currency
    from public.accounts account
   where account.id = import_row.account_id
     and account.user_id = authenticated_user_id;

  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  perform private.validate_financial_resources(
    authenticated_user_id, import_row.account_id, p_category_id, account_currency
  );

  source_provider := coalesce(
    nullif(lower(regexp_replace(btrim(import_row.metadata->>'source_provider'), '[[:space:]]+', '-', 'g')), ''),
    'generic'
  );

  for row_item in select item.value from jsonb_array_elements(p_rows) item(value)
  loop
    current_row_number := null;
    transaction_date := null;
    current_kind := null;
    current_amount := null;
    current_description := null;
    current_notes := null;
    current_external_id := null;

    if jsonb_typeof(row_item) <> 'object'
       or coalesce(row_item->>'row_number', '') !~ '^[0-9]{1,6}$'
       or coalesce(row_item->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or coalesce(row_item->>'kind', '') not in ('income', 'expense')
       or coalesce(row_item->>'amount', '') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
       or char_length(btrim(coalesce(row_item->>'description', ''))) not between 1 and 200
       or char_length(coalesce(row_item->>'notes', '')) > 2000
       or char_length(coalesce(row_item->>'external_id', '')) > 200 then
      row_number := case
        when coalesce(row_item->>'row_number', '') ~ '^[0-9]{1,6}$'
          then (row_item->>'row_number')::integer
        else 0
      end;
      result_status := 'invalid';
      transaction_id := null;
      error_code := 'invalid_row';
      error_message := 'The normalized row does not satisfy the CSV contract';
      invalid_count := invalid_count + 1;
      return next;
      continue;
    end if;

    begin
      current_row_number := (row_item->>'row_number')::integer;
      transaction_date := (row_item->>'date')::date;
      current_kind := (row_item->>'kind')::public.transaction_kind;
      current_amount := (row_item->>'amount')::numeric;
    exception
      when invalid_datetime_format or datetime_field_overflow or invalid_text_representation
           or numeric_value_out_of_range then
        row_number := coalesce(current_row_number, 0);
        result_status := 'invalid';
        transaction_id := null;
        error_code := sqlstate;
        error_message := left(sqlerrm, 300);
        invalid_count := invalid_count + 1;
        return next;
        continue;
    end;

    if current_amount <= 0 then
      row_number := current_row_number;
      result_status := 'invalid';
      transaction_id := null;
      error_code := 'invalid_amount';
      error_message := 'Amount must be greater than zero';
      invalid_count := invalid_count + 1;
      return next;
      continue;
    end if;

    current_description := regexp_replace(btrim(row_item->>'description'), '[[:space:]]+', ' ', 'g');
    current_notes := nullif(btrim(row_item->>'notes'), '');
    current_external_id := nullif(btrim(row_item->>'external_id'), '');

    begin
      created_transaction := private.create_financial_transaction_core(
        authenticated_user_id,
        import_row.account_id,
        current_kind,
        current_amount,
        account_currency,
        transaction_date,
        current_description,
        p_category_id,
        current_notes,
        false,
        null,
        'posted',
        'csv',
        current_external_id,
        '{}'::uuid[],
        import_row.id,
        source_provider
      );

      row_number := current_row_number;
      result_status := 'imported';
      transaction_id := created_transaction.id;
      error_code := null;
      error_message := null;
      imported_count := imported_count + 1;
      return next;
    exception
      when unique_violation then
        get stacked diagnostics violated_constraint = constraint_name;
        if violated_constraint <> 'transactions_csv_external_identity_unique' then
          raise;
        end if;

        row_number := current_row_number;
        result_status := 'duplicate';
        transaction_id := null;
        error_code := 'external_id_duplicate';
        error_message := 'A CSV transaction with this external ID already exists';
        duplicate_count := duplicate_count + 1;
        return next;
      when check_violation then
        get stacked diagnostics violated_constraint = constraint_name;
        if violated_constraint not in (
          'transactions_amount_positive_check',
          'transactions_description_length_check',
          'transactions_notes_length_check',
          'transactions_external_id_length_check'
        ) then
          raise;
        end if;

        row_number := current_row_number;
        result_status := 'failed';
        transaction_id := null;
        error_code := violated_constraint;
        error_message := left(sqlerrm, 300);
        failed_count := failed_count + 1;
        return next;
    end;
  end loop;

  update public.csv_imports
     set rows_imported = rows_imported + imported_count,
         rows_duplicate = rows_duplicate + duplicate_count,
         rows_invalid = rows_invalid + invalid_count,
         rows_failed = rows_failed + failed_count,
         rows_skipped = rows_skipped + duplicate_count + invalid_count + failed_count,
         updated_at = now()
   where id = import_row.id;
end
$$;

revoke all on function public.import_csv_transactions_batch(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.import_csv_transactions_batch(uuid, uuid, jsonb)
  to authenticated;

comment on column public.csv_imports.file_hash is
  'Lowercase SHA-256 of the original CSV bytes, calculated before decoding.';
comment on column public.transactions.import_match_hash is
  'Non-unique heuristic used only to warn about possible CSV duplicates.';
comment on index public.transactions_csv_external_identity_unique is
  'Strong CSV deduplication scoped by user, account, source/provider and external ID.';
