-- Enforce the reversible MXN-only MVP boundary through the account default and
-- authenticated column privileges. Currency columns remain available for a
-- future explicit multicurrency feature; RLS and accounting logic are unchanged.

do $$
declare
  currency_default text;
begin
  if exists (
    select 1
    from public.accounts
    where currency is null
       or currency is distinct from 'MXN'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'MXN-only migration aborted: public.accounts contains NULL or non-MXN currency values.';
  end if;

  select pg_get_expr(default_definition.adbin, default_definition.adrelid)
    into currency_default
    from pg_catalog.pg_attrdef default_definition
    join pg_catalog.pg_attribute attribute_definition
      on attribute_definition.attrelid = default_definition.adrelid
     and attribute_definition.attnum = default_definition.adnum
   where default_definition.adrelid = 'public.accounts'::regclass
     and attribute_definition.attname = 'currency';

  if currency_default is distinct from '''MXN''::text' then
    raise exception using
      errcode = 'P0001',
      message = format(
        'MXN-only migration aborted: public.accounts.currency default is %s, expected %s.',
        coalesce(currency_default, 'NULL'),
        '''MXN''::text'
      );
  end if;
end
$$;

revoke insert (currency) on public.accounts from authenticated;
revoke update (currency) on public.accounts from authenticated;
