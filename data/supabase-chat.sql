-- ============================================================
-- BOSSB COFFEE SHOP — CHAT (customer ↔ staff)
-- ------------------------------------------------------------
-- Run this in Supabase → SQL Editor → New query → Run.
--
-- One row per message. Media (images + voice notes) are stored
-- inline as base64 data URLs in `body` (kept small via client-
-- side image compression + short voice clips) so no separate
-- Storage bucket setup is needed. `size_bytes` lets the app
-- prune the OLDEST media when the combined media footprint
-- exceeds its cap (~10% of the free DB), keeping usage bounded.
-- ============================================================

create table if not exists public.bb_messages (
  id          text primary key,
  table_label text,                       -- the table thread this belongs to
  sender      text not null,              -- clientId of customer, or 'admin'
  sender_name text,
  role        text not null check (role in ('customer', 'admin')),
  kind        text not null check (kind in ('text', 'image', 'audio')),
  body        text,                        -- text, or a data: URL for media
  size_bytes  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists bb_messages_thread_idx  on public.bb_messages (table_label, created_at);
create index if not exists bb_messages_media_idx   on public.bb_messages (kind, created_at);

-- Broadcast inserts/deletes so both sides see messages live.
-- Guarded so re-running doesn't error with 42710.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bb_messages'
  ) then
    alter publication supabase_realtime add table public.bb_messages;
  end if;
end $$;

-- Prototype-grade RLS (matches the other tables): open to anon.
alter table public.bb_messages enable row level security;
drop policy if exists "messages read"   on public.bb_messages;
drop policy if exists "messages insert" on public.bb_messages;
drop policy if exists "messages delete" on public.bb_messages;
create policy "messages read"   on public.bb_messages for select using (true);
create policy "messages insert" on public.bb_messages for insert with check (true);
create policy "messages delete" on public.bb_messages for delete using (true);

-- ------------------------------------------------------------
-- REACTIONS + REPLIES  (added later — safe to re-run)
--   reaction      : the single "❤️" tap-to-react, or NULL
--   reply_to      : id of the message this one replies to
--   reply_preview : cached "Sender: snippet" so the quoted line
--                   renders without a second lookup
-- Plus an UPDATE policy so a reaction can be toggled on a row.
-- The app degrades gracefully if this block hasn't been run yet
-- (it strips the unknown columns and still sends the message).
-- ------------------------------------------------------------
alter table public.bb_messages add column if not exists reaction      text;
alter table public.bb_messages add column if not exists reply_to      text;
alter table public.bb_messages add column if not exists reply_preview text;

drop policy if exists "messages update" on public.bb_messages;
create policy "messages update" on public.bb_messages for update using (true) with check (true);
