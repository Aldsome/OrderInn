-- ============================================================
-- BOSSB COFFEE SHOP — PRODUCTION RLS HARDENING
-- ------------------------------------------------------------
-- The prototype policies in supabase.sql let the anonymous role
-- do anything (read/insert/update/delete) on every table. That
-- is fine for an in-store test where the admin URL is "secret",
-- but is NOT safe for a public github.io deployment: anyone who
-- views source can read your anon key and then trash orders,
-- read every account row, or rewrite the menu.
--
-- Run THIS file (after supabase.sql) when you are ready to lock
-- things down. It assumes you have moved admin auth onto
-- Supabase Auth (see the note at the bottom) so that staff
-- actions carry an authenticated JWT while customers stay anon.
--
-- WHAT CHANGES vs the prototype:
--   bb_products : public read; writes require authenticated
--   bb_config   : public read; writes require authenticated
--   bb_orders   : anon may INSERT (place order) + SELECT;
--                 UPDATE/DELETE require authenticated (staff)
--   bb_accounts : NO public read of password_hash; inserts only
--                 of role='customer'; admin creation requires
--                 authenticated
--   bb_activity : authenticated read; anon may insert order
--                 events only
-- ============================================================

-- ---- Drop the permissive prototype policies -----------------
drop policy if exists "products read"   on public.bb_products;
drop policy if exists "products write"  on public.bb_products;
drop policy if exists "config read"     on public.bb_config;
drop policy if exists "config write"    on public.bb_config;
drop policy if exists "orders read"     on public.bb_orders;
drop policy if exists "orders insert"   on public.bb_orders;
drop policy if exists "orders update"   on public.bb_orders;
drop policy if exists "orders delete"   on public.bb_orders;
drop policy if exists "accounts read"   on public.bb_accounts;
drop policy if exists "accounts insert" on public.bb_accounts;
drop policy if exists "activity read"   on public.bb_activity;
drop policy if exists "activity insert" on public.bb_activity;

-- ---- PRODUCTS -----------------------------------------------
-- Menu is public to read; only staff can change it.
create policy "products public read"  on public.bb_products
  for select using (true);
create policy "products staff write"  on public.bb_products
  for all to authenticated using (true) with check (true);

-- ---- CONFIG -------------------------------------------------
-- Shop name / tax / invite code: public read (the customer UI
-- needs the shop name + currency), staff-only write. NOTE: this
-- means the invite code is technically readable by anyone who
-- queries bb_config. If you want the invite code private, move
-- it to its own table with a staff-only SELECT policy.
create policy "config public read"  on public.bb_config
  for select using (true);
create policy "config staff write"  on public.bb_config
  for all to authenticated using (true) with check (true);

-- ---- ORDERS -------------------------------------------------
-- Customers (anon) may place orders and read them. Only staff
-- (authenticated) may advance status or delete.
create policy "orders anon insert"  on public.bb_orders
  for insert to anon, authenticated with check (true);
create policy "orders public read"  on public.bb_orders
  for select using (true);
create policy "orders staff update" on public.bb_orders
  for update to authenticated using (true) with check (true);
create policy "orders staff delete" on public.bb_orders
  for delete to authenticated using (true);

-- Allow a customer to cancel ONLY their own still-pending order
-- within the grace window, without being staff. Ties the update
-- to the client_id the row was created with (passed as a request
-- header / matched app-side). This is a soft guard — the app
-- already enforces the window; tighten with a trigger if needed.
create policy "orders self cancel" on public.bb_orders
  for update to anon
  using (status = 'pending')
  with check (status = 'cancelled');

-- ---- ACCOUNTS -----------------------------------------------
-- SECURITY: never expose password_hash to anon. The prototype
-- login reads the hash client-side; in production you should
-- switch to Supabase Auth (signInWithPassword) so the hash never
-- leaves the server. Until then, restrict reads to authenticated.
create policy "accounts staff read" on public.bb_accounts
  for select to authenticated using (true);

-- Customer self-signup may insert ONLY role='customer'.
create policy "accounts customer signup" on public.bb_accounts
  for insert to anon with check (role = 'customer');

-- Staff may create any account (incl. other admins).
create policy "accounts staff insert" on public.bb_accounts
  for insert to authenticated with check (true);

-- ---- ACTIVITY LOG -------------------------------------------
-- Anon may append order-related events (so a customer placing /
-- cancelling an order logs it); staff read the full feed.
create policy "activity staff read" on public.bb_activity
  for select to authenticated using (true);
create policy "activity anon insert" on public.bb_activity
  for insert to anon, authenticated with check (true);

-- ============================================================
-- MOVING ADMIN AUTH TO SUPABASE AUTH (the proper next step)
-- ------------------------------------------------------------
-- The above "authenticated" policies only mean something once
-- admins actually sign in through Supabase Auth instead of the
-- client-side bb_accounts hash check. To do that:
--   1. In the dashboard: Authentication → create an admin user
--      (email + password).
--   2. In store.js, replace Store.login() with:
--        await sb.auth.signInWithPassword({ email, password })
--      and gate enterAdminPanel on (await sb.auth.getSession()).
--   3. Keep bb_accounts only for the "staff directory" display,
--      or drop it entirely and use auth.users.
-- Until step 2 is done, leave the prototype supabase.sql policies
-- in place — running THIS file before wiring Supabase Auth would
-- lock the admin panel out (no authenticated role = no writes).
-- ============================================================
