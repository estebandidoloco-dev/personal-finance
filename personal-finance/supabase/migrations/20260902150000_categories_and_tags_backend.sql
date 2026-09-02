-- P1.2: budgets keep their category instead of being deleted with it.
-- category_id is NOT NULL, so RESTRICT is the explicit integrity rule.
alter table public.budgets
  drop constraint budgets_category_id_fkey;

alter table public.budgets
  add constraint budgets_category_id_fkey
  foreign key (category_id)
  references public.categories(id)
  on delete restrict;