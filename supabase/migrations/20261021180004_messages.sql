-- =============================================================
-- KLIK Migration 004: messages (+ indeks pagination)
-- Idempotensi: id dihasilkan KLIEN (client-generated UUID).
-- Kirim ulang dengan id sama = conflict -> tidak ada pesan ganda.
-- Pagination: cursor (created_at, id) ascending/descending, bukan seluruh riwayat.
-- =============================================================

create table if not exists public.messages (
  id         uuid primary key,
  room_id    uuid not null references public.chat_rooms (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  reply_to   uuid references public.messages (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists messages_room_cursor_idx
  on public.messages (room_id, created_at desc, id desc);

create index if not exists messages_sender_idx
  on public.messages (sender_id);

alter table public.messages enable row level security;

-- Tidak ada policy UPDATE/DELETE di Milestone 2: pesan bersifat append-only.
