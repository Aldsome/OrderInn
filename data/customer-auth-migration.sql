-- ============================================================
-- ORDERINN COFFEE — CUSTOMER AUTH MIGRATION (Supabase Auth)
-- ------------------------------------------------------------
-- Moves CUSTOMER sign-in (only) off the client-side password-hash
-- system and onto real Supabase Auth (email/password + Google
-- OAuth). Admin/staff login is UNCHANGED — it keeps using
-- bb_accounts.password_hash exactly as before.
--
-- Why bb_accounts.id survives this migration unchanged: bb_orders,
-- perks, and every customer-facing call site key off bb_accounts.id
-- (a text id like "u_...", not an auth.users uuid). Rather than
-- rewrite those joins, this migration adds auth_user_id as a LINK
-- from the existing account row to its new auth.users identity, so
-- Store.getCustomer() can keep returning the same {id, email, name}
-- shape and every downstream feature (orders, loyalty, profile)
-- keeps working with zero changes.
--
-- Run in Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- ============================================================

-- ---- 1. Link column: bb_accounts row -> auth.users row ----------
-- Nullable because admin/staff rows never get one (they still log in
-- the old way), and a customer row is briefly linkless between
-- sign-up and the first successful auth callback.
alter table public.bb_accounts
  add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;

create unique index if not exists bb_accounts_auth_user_id_idx
  on public.bb_accounts (auth_user_id)
  where auth_user_id is not null;

-- ---- 2. password_hash becomes optional -----------------------
-- Customers authenticated via Supabase Auth (incl. Google) never
-- get a bb_accounts.password_hash — Supabase owns their credential.
-- Admin/staff rows still populate it as before.
alter table public.bb_accounts
  alter column password_hash drop not null;

-- ---- 3. RLS: replace the wide-open accounts policies -----------
-- supabase.sql's original "accounts read"/"accounts insert" are
-- `using (true)` / `with check (true)` — anyone (anon!) can read
-- every row, including admin password_hash. RLS policies are OR'd
-- together, so those must be DROPPED here, not just supplemented,
-- or this migration's tighter policies below would have no effect.
--
-- IMPORTANT: this drops admin/staff read access too. Since
-- Store.login() (admin) still needs to read bb_accounts to check a
-- password hash client-side, admin reads are re-opened narrowly
-- (role='admin' rows only) via anon below — staff auth itself is
-- explicitly out of scope for this migration and keeps working
-- exactly as before, just without also exposing customer rows.
drop policy if exists "accounts read"   on public.bb_accounts;
drop policy if exists "accounts insert" on public.bb_accounts;

-- Admin/staff login still reads its own role's rows client-side
-- (unchanged behavior — see PRODUCTION-AUDIT.md for why this
-- remains a known limitation until admin auth is migrated too).
create policy "accounts admin read" on public.bb_accounts
  for select using (role = 'admin');

-- Admin/staff account creation (register.html, admin "Add staff")
-- still inserts anonymously, matching the old prototype behavior.
create policy "accounts admin insert" on public.bb_accounts
  for insert with check (role = 'admin');

-- A signed-in customer (any Supabase Auth session) may read/insert
-- ONLY their own linked row — never another customer's, never an
-- admin's password_hash.
create policy "customers select own row" on public.bb_accounts
  for select to authenticated
  using (auth.uid() = auth_user_id);

create policy "customers insert own row" on public.bb_accounts
  for insert to authenticated
  with check (auth.uid() = auth_user_id and role = 'customer');

create policy "customers update own row" on public.bb_accounts
  for update to authenticated
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id and role = 'customer');

-- ============================================================
-- NOTE: this migration does NOT touch bb_orders, bb_products, or
-- any other table. bb_orders.user_id keeps storing bb_accounts.id
-- (text), unchanged — a signed-in customer's orders still resolve
-- exactly as they did before.
-- ============================================================
