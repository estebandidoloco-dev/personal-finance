\set ON_ERROR_STOP on

begin;

create temporary table test_results(test_name text primary key, passed boolean not null);
create function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'FAIL: %', p_name; end if;
  insert into test_results values (p_name, true);
end
$$;

create temporary table formatter_cases(input numeric, expected text);
insert into formatter_cases(input, expected) values
  (0, '0.00'),
  (0.01, '0.01'),
  (-0.01, '-0.01'),
  (1.20, '1.20'),
  (-1.20, '-1.20'),
  (999999999999999.99, '999999999999999.99'),
  (1000000000000000.00, '1000000000000000.00'),
  (-1000000000000000.00, '-1000000000000000.00'),
  (999999999999999999999999999999.99, '999999999999999999999999999999.99'),
  (-999999999999999999999999999999.99, '-999999999999999999999999999999.99'),
  (1.234, '1.23'),
  (1.235, '1.24'),
  (-1.235, '-1.24'),
  (-0.001, '0.00');

select pg_temp.assert_true('formatter devuelve todos los casos exactos', not exists (
  select 1 from formatter_cases
   where private.format_exact_money(input) is distinct from expected
));
select pg_temp.assert_true('formatter no produce caracteres no canonicos', not exists (
  select 1 from formatter_cases
   where private.format_exact_money(input) ~ '[#,eE[:space:]]'
      or private.format_exact_money(input) like '%,%'
));
select pg_temp.assert_true('formatter conserva null', private.format_exact_money(null) is null);

select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;

rollback;
