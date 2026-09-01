-- 0. Extensiones
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 1. Perfiles (extiende auth.users)
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  avatar_url text,
  currency text default 'MXN',
  created_at timestamptz default now()
);

-- Trigger: crear profile al registrar usuario
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'avatar_url');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Cuentas
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  type text not null check (type in ('checking','savings','credit','cash','investment','other')),
  balance numeric(14,2) default 0,
  currency text default 'MXN',
  is_shared boolean default false,
  institution text,
  last_synced_at timestamptz,
  created_at timestamptz default now()
);

-- 3. Categorías (jerarquía simple, personalizables)
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  parent_id uuid references public.categories(id) on delete set null,
  name text not null,
  icon text,
  color text,
  type text not null check (type in ('expense','income','transfer','savings')),
  budget_type text check (budget_type in ('need','want','savings')), -- para 50/30/20
  is_system boolean default false,
  sort_order int default 0,
  created_at timestamptz default now()
);

-- 4. Tags libres
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  color text,
  unique(user_id, name)
);

-- 5. Transacciones (core)
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  category_id uuid references public.categories(id) on delete set null,
  amount numeric(14,2) not null,
  currency text default 'MXN',
  date date not null,
  description text not null,
  notes text,
  is_shared boolean default false,
  split_ratio jsonb,
  status text default 'posted' check (status in ('pending','posted','cancelled','duplicate')),
  source text default 'manual' check (source in ('manual','csv','openbanking','recurring')),
  external_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 6. Transaction <-> Tags (many-to-many)
create table public.transaction_tags (
  transaction_id uuid references public.transactions(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade,
  primary key (transaction_id, tag_id)
);

-- 7. Presupuestos mensuales por categoría
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  month date not null,
  amount numeric(14,2) not null,
  alert_threshold numeric(3,2) default 0.8,
  created_at timestamptz default now(),
  unique(user_id, category_id, month)
);

-- 8. Metas de ahorro
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null,
  current_amount numeric(14,2) default 0,
  target_date date,
  category_id uuid references public.categories(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  color text,
  icon text,
  is_shared boolean default false,
  created_at timestamptz default now()
);

-- 9. Suscripciones
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  amount numeric(14,2) not null,
  currency text default 'MXN',
  billing_cycle text not null check (billing_cycle in ('weekly','monthly','quarterly','yearly','custom')),
  next_charge_date date not null,
  last_charge_date date,
  status text default 'active' check (status in ('active','paused','cancelled')),
  detection_confidence numeric(3,2),
  created_at timestamptz default now()
);

-- 10. Importaciones CSV (auditoría)
create table public.csv_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  filename text not null,
  rows_total int not null,
  rows_imported int not null,
  rows_skipped int not null,
  errors jsonb,
  created_at timestamptz default now()
);

-- 11. Reglas de reparto (split rules)
create table public.split_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  ratios jsonb not null,
  is_default boolean default false,
  created_at timestamptz default now()
);

-- ÍNDICES
create index idx_transactions_user_date on public.transactions(user_id, date desc);
create index idx_transactions_account_date on public.transactions(account_id, date desc);
create index idx_transactions_category on public.transactions(category_id);
create index idx_transactions_shared on public.transactions(is_shared) where is_shared = true;
create index idx_budgets_user_month on public.budgets(user_id, month);
create index idx_accounts_user on public.accounts(user_id);
create index idx_categories_user on public.categories(user_id);

-- RLS (Row Level Security)
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_tags enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.subscriptions enable row level security;
alter table public.csv_imports enable row level security;
alter table public.split_rules enable row level security;

-- Políticas: cada usuario ve/gestiona lo suyo + compartido
create policy "own_profile" on public.profiles for all using (auth.uid() = id);

create policy "own_accounts" on public.accounts for all using (auth.uid() = user_id);

create policy "own_categories" on public.categories for all using (auth.uid() = user_id or user_id is null);

create policy "own_tags" on public.tags for all using (auth.uid() = user_id);

create policy "own_transactions" on public.transactions for all using (
  auth.uid() = user_id
  or is_shared = true
);

create policy "own_transaction_tags" on public.transaction_tags for all using (
  exists (select 1 from public.transactions t where t.id = transaction_tags.transaction_id and t.user_id = auth.uid())
);

create policy "own_budgets" on public.budgets for all using (auth.uid() = user_id);

create policy "own_goals" on public.goals for all using (
  auth.uid() = user_id
  or is_shared = true
);

create policy "own_subscriptions" on public.subscriptions for all using (auth.uid() = user_id);

create policy "own_csv_imports" on public.csv_imports for all using (auth.uid() = user_id);

create policy "own_split_rules" on public.split_rules for all using (auth.uid() = user_id);

-- Categorías semilla (sistema, user_id = null)
insert into public.categories (user_id, name, icon, color, type, budget_type, is_system, sort_order) values
  (null, 'Vivienda', 'home', '#ef4444', 'expense', 'need', true, 1),
  (null, 'Alimentación', 'utensils', '#f97316', 'expense', 'need', true, 2),
  (null, 'Transporte', 'car', '#eab308', 'expense', 'need', true, 3),
  (null, 'Salud', 'heart-pulse', '#22c55e', 'expense', 'need', true, 4),
  (null, 'Ocio', 'gamepad-2', '#3b82f6', 'expense', 'want', true, 5),
  (null, 'Compras', 'shopping-bag', '#8b5cf6', 'expense', 'want', true, 6),
  (null, 'Suscripciones', 'credit-card', '#ec4899', 'expense', 'want', true, 7),
  (null, 'Otros gastos', 'more-horizontal', '#6b7280', 'expense', 'want', true, 8),
  (null, 'Nómina', 'banknote', '#22c55e', 'income', null, true, 10),
  (null, 'Inversiones', 'trending-up', '#3b82f6', 'income', null, true, 11),
  (null, 'Otros ingresos', 'plus-circle', '#6b7280', 'income', null, true, 12),
  (null, 'Ahorro/Inversión', 'piggy-bank', '#10b981', 'savings', 'savings', true, 20),
  (null, 'Transferencias', 'arrow-left-right', '#6b7280', 'transfer', null, true, 30);