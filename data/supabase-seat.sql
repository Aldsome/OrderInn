-- ============================================================
-- BOSSB COFFEE SHOP — SEAT / LOCATION COLUMN
-- ------------------------------------------------------------
-- Run this in Supabase → SQL Editor → New query → Run.
--
-- Adds an optional `seat` (physical table/location) to orders,
-- decoupled from `table_number`, which is the customer's IDENTITY
-- label (their name/room/tab). This lets a guest move seats without
-- changing their identity or orphaning their orders.
--
-- Safe to run multiple times. The app self-heals if this hasn't
-- been run yet (it simply syncs orders without the seat until the
-- column exists), so there's no hard ordering requirement — but run
-- it to actually persist the seat across devices.
-- ============================================================

alter table public.bb_orders
  add column if not exists seat text;
