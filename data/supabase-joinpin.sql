-- ============================================================
-- BOSSB COFFEE SHOP — TABLE JOIN PIN
-- ------------------------------------------------------------
-- Run this in Supabase → SQL Editor → New query → Run.
-- REQUIRED before deploying the join-PIN feature: without this
-- column, order writes that include join_pin will be rejected
-- by PostgREST and orders won't sync.
--
-- The PIN is minted by the first order at a table label and
-- inherited by later orders at the same table. The customer's
-- "Join this table" gate checks the entered PIN against it,
-- preventing a random person from piling orders onto someone
-- else's table.
-- ============================================================

alter table public.bb_orders
  add column if not exists join_pin text;
