-- ============================================================
-- ORDERINN COFFEE — CUSTOMER ACCOUNT DELETION (15-day grace period)
-- ------------------------------------------------------------
-- Customers can request account deletion from the profile modal.
-- The account is soft-deleted (deletion_requested_at is stamped)
-- and stays fully usable for 15 days in case the customer changes
-- their mind, after which it is purged for good.
--
-- There is no server-side cron in this project, so the actual
-- purge (real DELETE) is opportunistic: it runs client-side, only
-- against the signed-in customer's OWN row, the next time that
-- customer's session resumes past the 15-day deadline. An account
-- that never signs back in stays soft-deleted (and hidden/blocked)
-- indefinitely — acceptable for now; a scheduled Edge Function is
-- the natural follow-up if that ever needs a hard guarantee.
--
-- Run in Supabase -> SQL Editor -> New query -> Run. Safe to re-run.
-- ============================================================

alter table public.bb_accounts
  add column if not exists deletion_requested_at timestamptz;

-- Lets a signed-in customer purge (hard-delete) ONLY their own row,
-- and only once the 15-day grace period has actually elapsed. This
-- is intentionally stricter than the existing "customers update own
-- row" policy so a client can't delete its account instantly by
-- skipping the grace period.
drop policy if exists "customers delete own row after grace" on public.bb_accounts;
create policy "customers delete own row after grace" on public.bb_accounts
  for delete to authenticated
  using (
    auth.uid() = auth_user_id
    and deletion_requested_at is not null
    and deletion_requested_at <= now() - interval '15 days'
  );
