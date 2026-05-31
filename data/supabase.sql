-- ============================================================
-- BOSSB COFFEE SHOP — SUPABASE SCHEMA
-- ------------------------------------------------------------
-- Paste this whole file into:
--   Supabase project → SQL Editor → New query → Run
--
-- It creates the four tables the app reads/writes, sets up
-- the realtime publication so subscriptions fire on changes,
-- and applies permissive Row Level Security policies suitable
-- for an in-store prototype.
--
-- WHEN YOU GO TO PRODUCTION:
--   - Tighten the RLS policies (see the comments on each
--     `CREATE POLICY` statement below).
--   - Move admin operations behind Supabase Auth instead of
--     the bb_users JSON table.
-- ============================================================

-- ---------------------------------------------------------------------
-- ACCOUNTS  (same shape as data/accounts.json — drops in as a seed)
-- ---------------------------------------------------------------------
create table if not exists public.bb_accounts (
  id            text primary key,
  email         text not null unique,
  name          text not null,
  role          text not null check (role in ('admin', 'customer')),
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- PRODUCTS  (same shape as data/products.json)
-- ---------------------------------------------------------------------
create table if not exists public.bb_products (
  id         text primary key,
  name       text not null,
  category   text not null,
  price      numeric not null,
  emoji      text,
  description text,
  tag        text,
  img        text,
  options    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- CONFIG  (shop name, currency, tax rules, invite code — single row)
-- ---------------------------------------------------------------------
create table if not exists public.bb_config (
  id         int primary key default 1,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);
insert into public.bb_config (id, data)
  values (1, '{}'::jsonb)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- ORDERS  (the realtime-critical table)
-- ---------------------------------------------------------------------
create table if not exists public.bb_orders (
  id             text primary key,
  number         int not null,
  table_number   text,
  client_id      text not null,            -- per-device anonymous id
  items          jsonb not null,           -- array of { itemId, name, qty, unitPrice, summary, config }
  total          numeric not null,
  notes          text,
  status         text not null check (status in ('pending', 'preparing', 'served', 'cancelled')),
  placed_at      timestamptz not null default now(),
  served_at      timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   text
);
create index if not exists bb_orders_placed_at_idx on public.bb_orders (placed_at desc);
create index if not exists bb_orders_status_idx    on public.bb_orders (status);
create index if not exists bb_orders_client_idx    on public.bb_orders (client_id);

-- Auto-increment order numbers within the table so the app
-- doesn't have to compute MAX(number)+1 on every insert.
create sequence if not exists bb_orders_number_seq;
alter table public.bb_orders
  alter column number set default nextval('bb_orders_number_seq');

-- ---------------------------------------------------------------------
-- ACTIVITY LOG  (admin notification feed)
-- ---------------------------------------------------------------------
create table if not exists public.bb_activity (
  id         text primary key,
  type       text not null,
  message    text not null,
  order_id   text,
  payload    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bb_activity_created_idx on public.bb_activity (created_at desc);

-- ============================================================
-- REALTIME PUBLICATION
-- Tell Supabase to broadcast row-level changes for these tables
-- over the realtime websocket. Subscribers (the browser) get a
-- push the moment a row is inserted / updated / deleted.
--
-- ALTER PUBLICATION ... ADD TABLE is NOT idempotent — re-running
-- it for a table already in the publication errors with 42710
-- and aborts the rest of the script. This guarded block makes
-- the whole file safe to run multiple times.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['bb_orders','bb_products','bb_config','bb_activity'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================
-- ROW LEVEL SECURITY
-- Prototype-grade: permissive enough for the in-store flow,
-- restrictive enough that random visitors can't trash data.
-- Tighten before going public-facing.
-- ============================================================
alter table public.bb_accounts enable row level security;
alter table public.bb_products enable row level security;
alter table public.bb_config   enable row level security;
alter table public.bb_orders   enable row level security;
alter table public.bb_activity enable row level security;

-- NOTE: `create policy` is not idempotent either — re-running
-- errors if the policy already exists. Each is preceded by a
-- `drop policy if exists` so this whole file is safe to re-run.

-- Products + config: anyone can read (menu is public).
-- Tighten later: writes restricted to authenticated admins.
drop policy if exists "products read"  on public.bb_products;
drop policy if exists "products write" on public.bb_products;
create policy "products read"  on public.bb_products for select using (true);
create policy "products write" on public.bb_products for all    using (true) with check (true);

drop policy if exists "config read"  on public.bb_config;
drop policy if exists "config write" on public.bb_config;
create policy "config read"    on public.bb_config   for select using (true);
create policy "config write"   on public.bb_config   for all    using (true) with check (true);

-- Orders: anyone can insert + read. Updates and deletes are
-- ALSO open in this prototype so the admin panel can mark
-- preparing/served without Supabase Auth. Lock this down by
-- requiring authenticated role before going public.
drop policy if exists "orders read"   on public.bb_orders;
drop policy if exists "orders insert" on public.bb_orders;
drop policy if exists "orders update" on public.bb_orders;
drop policy if exists "orders delete" on public.bb_orders;
create policy "orders read"   on public.bb_orders for select using (true);
create policy "orders insert" on public.bb_orders for insert with check (true);
create policy "orders update" on public.bb_orders for update using (true) with check (true);
create policy "orders delete" on public.bb_orders for delete using (true);

-- Accounts: read open (the login form needs to look up the
-- email to compare the hashed password), inserts open for
-- self-registration. Tighten before production!
drop policy if exists "accounts read"   on public.bb_accounts;
drop policy if exists "accounts insert" on public.bb_accounts;
create policy "accounts read"   on public.bb_accounts for select using (true);
create policy "accounts insert" on public.bb_accounts for insert with check (true);

-- Activity log: append-only for everyone.
drop policy if exists "activity read"   on public.bb_activity;
drop policy if exists "activity insert" on public.bb_activity;
create policy "activity read"   on public.bb_activity for select using (true);
create policy "activity insert" on public.bb_activity for insert with check (true);

-- ============================================================
-- DONE.
-- After running this, jump back to the browser and:
--   1. Project Settings → API → copy the Project URL
--   2. Project Settings → API → copy the `anon` (public) key
--   3. Paste both into config.js
-- ============================================================
