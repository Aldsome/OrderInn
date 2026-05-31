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
alter publication supabase_realtime add table public.bb_messages;

-- Prototype-grade RLS (matches the other tables): open to anon.
alter table public.bb_messages enable row level security;
create policy "messages read"   on public.bb_messages for select using (true);
create policy "messages insert" on public.bb_messages for insert with check (true);
create policy "messages delete" on public.bb_messages for delete using (true);
