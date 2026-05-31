-- ============================================================
-- BOSSB COFFEE SHOP — LIVE SESSIONS TABLE
-- ------------------------------------------------------------
-- Run this in Supabase → SQL Editor → New query → Run.
--
-- Tracks which table label each device is currently "holding"
-- so two devices can't claim the same name (e.g. both "art")
-- at the same time, even before either has placed an order.
-- A row is upserted when a customer sets their table label and
-- refreshed on a heartbeat; rows older than 30 minutes are
-- treated as stale (the app filters by last_active at query
-- time, and devices delete their own row when they reset).
-- ============================================================

create table if not exists public.bb_sessions (
  client_id   text primary key,
  name        text not null,
  last_active timestamptz not null default now()
);
create index if not exists bb_sessions_name_idx        on public.bb_sessions (lower(name));
create index if not exists bb_sessions_last_active_idx on public.bb_sessions (last_active desc);

-- Prototype-grade RLS (matches the other tables in supabase.sql):
-- open to the anon role so the customer UI can read/claim names.
alter table public.bb_sessions enable row level security;
create policy "sessions read"  on public.bb_sessions for select using (true);
create policy "sessions write" on public.bb_sessions for all    using (true) with check (true);
