-- ============================================================
-- ORDERINN COFFEE — ADMIN AUTH MIGRATION (Supabase Auth)
-- ------------------------------------------------------------
-- Moves ADMIN/STAFF sign-in off the client-side password-hash
-- system (bb_accounts.password_hash checked in the browser) and
-- onto real Supabase Auth (email/password + Google OAuth) — the
-- same move customer-auth-migration.sql already made for
-- customers. Both supabase-harden.sql and customer-auth-migration
-- .sql explicitly anticipated this as the next step; this file
-- finishes it.
--
-- WHY THIS WAS NEEDED (not just cleanup): the live RLS policies on
-- bb_accounts already require an authenticated Supabase session to
-- write admin rows in some prior states of this policy set. Admin
-- signup was still running as anon, so those inserts were being
-- silently rejected — remoteUpsert() in store.js is fire-and-forget
-- and swallows RLS denials, so account creation LOOKED like it
-- succeeded (written to localStorage) but never reached the server.
-- The next page load's authoritative bb_accounts pull then wiped the
-- phantom local account, producing "account not found" on the next
-- login attempt. This migration closes that gap the same way
-- customer auth already closed it for customers.
--
-- Run in Supabase -> SQL Editor -> New query -> Run. Safe to re-run
-- (idempotent) and safe regardless of which prior policy set —
-- supabase.sql's prototype, supabase-harden.sql's, or customer-auth-
-- migration.sql's — is currently live; every plausible old admin
-- policy name is dropped before the final set is created.
-- ============================================================

-- ---- 1. Link column: bb_accounts row -> auth.users row ----------
-- Shared with the customer migration — if customer-auth-migration.sql
-- already ran, this is a no-op. `if not exists` makes it safe either
-- order.
alter table public.bb_accounts
  add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;

create unique index if not exists bb_accounts_auth_user_id_idx
  on public.bb_accounts (auth_user_id)
  where auth_user_id is not null;

-- ---- 2. Drop every plausible prior admin-related policy ----------
-- Neither of us can currently confirm which of these are live on
-- this project — supabase-harden.sql and customer-auth-migration.sql
-- used different names for admin read/insert policies, and either
-- (or neither, or both) may have actually been run. Dropping all of
-- them here, then creating one clean final set below, converges to
-- the same correct end state no matter what's currently live.
drop policy if exists "accounts staff read"    on public.bb_accounts;   -- supabase-harden.sql
drop policy if exists "accounts staff insert"  on public.bb_accounts;   -- supabase-harden.sql
drop policy if exists "accounts admin read"    on public.bb_accounts;   -- customer-auth-migration.sql
drop policy if exists "accounts admin insert"  on public.bb_accounts;   -- customer-auth-migration.sql
drop policy if exists "accounts read"          on public.bb_accounts;   -- supabase.sql prototype
drop policy if exists "accounts insert"        on public.bb_accounts;   -- supabase.sql prototype

-- ---- 3. Final admin policies — real Supabase Auth required -------
-- An admin may read/insert/update ONLY their own linked row, exactly
-- mirroring customer-auth-migration.sql's "customers ... own row"
-- policies (lines 69-80 there). No more anon admin access at all —
-- password_hash is never exposed to anon, and no admin row can be
-- created without a real Supabase Auth session behind it.
create policy "admins select own row" on public.bb_accounts
  for select to authenticated
  using (auth.uid() = auth_user_id and role = 'admin');

create policy "admins insert own row" on public.bb_accounts
  for insert to authenticated
  with check (auth.uid() = auth_user_id and role = 'admin');

create policy "admins update own row" on public.bb_accounts
  for update to authenticated
  using (auth.uid() = auth_user_id and role = 'admin')
  with check (auth.uid() = auth_user_id and role = 'admin');

-- NOTE: Store.bootSeed()'s bulk `select * from bb_accounts` runs as
-- anon on every page load, before any sign-in. Under these policies
-- it will return ZERO admin rows to an anonymous caller — by design,
-- admin rows (including password_hash — always null now — and email)
-- are never exposed to anon. Store.isAdmin()/sessionStale() already
-- tolerate an empty local users cache (see the "if (!users.length)
-- return true" guard in isAdmin(), store.js), so this does not lock
-- a real, signed-in admin out; it only means the LOCAL cache has no
-- admin rows until that admin's own session populates one.

-- ============================================================
-- 4. MANUAL STEP — do this in the Supabase dashboard, not via SQL.
-- Creating a real Supabase Auth user cannot be done from this SQL
-- editor; it needs the dashboard (or the service-role admin API).
--
--   Authentication -> Users -> Add user
--     Email:             admin@orderinn.com
--     Password:          <choose a fresh, real password —
--                         do NOT reuse admin1234; that string is
--                         in this repo's history and comments, and
--                         becomes effectively public once this repo
--                         is ever shared or made public>
--     Auto Confirm User: ON  (skips the confirmation-email round
--                             trip for this one-time setup)
--
-- Then copy the new user's UUID (shown in the dashboard's Users
-- list, or run: select id from auth.users where email =
-- 'admin@orderinn.com';) and run the UPDATE below to link it to the
-- existing bb_accounts row. This is the "master admin" account —
-- intended to keep working indefinitely as a permanent super-admin
-- login, including if this app is later reused for other
-- businesses, so treat the new password as a real, durable
-- credential, not a throwaway.
-- ============================================================
update public.bb_accounts
  set auth_user_id = '<paste-the-new-auth-user-uuid-here>'
  where id = 'u_seed_admin';

-- Safe to re-run: 'u_seed_admin' is the stable id seedIfEmpty()
-- already matches by (store.js), so this UPDATE only ever touches
-- that one row and never affects any other admin account.

-- ============================================================
-- NOTE: this migration does NOT touch bb_orders, bb_products, or
-- any other table. It also does not remove password_hash from
-- existing rows — legacy admin rows keep their old hash (now
-- unused/dead in REMOTE mode) until they're re-created or manually
-- cleared; LOCAL mode (no Supabase configured) still reads it via
-- the untouched client-side hash-compare fallback in store.js.
-- ============================================================
