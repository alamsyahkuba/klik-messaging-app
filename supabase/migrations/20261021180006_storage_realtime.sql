-- =============================================================
-- KLIK Migration 006: device_tokens, storage bucket avatars, realtime
-- =============================================================

-- -------------------------------------------------------------
-- device_tokens (untuk push notification Milestone 6)
-- -------------------------------------------------------------
create table if not exists public.device_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  token      text not null unique,
  platform   text not null check (platform in ('android', 'ios', 'web')),
  created_at timestamptz not null default now()
);

alter table public.device_tokens enable row level security;

drop policy if exists "device_tokens_select_own" on public.device_tokens;
create policy "device_tokens_select_own"
  on public.device_tokens for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "device_tokens_insert_own" on public.device_tokens;
create policy "device_tokens_insert_own"
  on public.device_tokens for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "device_tokens_delete_own" on public.device_tokens;
create policy "device_tokens_delete_own"
  on public.device_tokens for delete to authenticated
  using (user_id = auth.uid());

-- -------------------------------------------------------------
-- Storage: bucket avatars (publik untuk dibaca, tulis hanya folder milik sendiri)
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatar_public_read" on storage.objects;
create policy "avatar_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatar_owner_insert" on storage.objects;
create policy "avatar_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatar_owner_update" on storage.objects;
create policy "avatar_owner_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatar_owner_delete" on storage.objects;
create policy "avatar_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- -------------------------------------------------------------
-- Realtime: hanya tabel yang memang perlu push ke klien.
-- Realtime menghormati RLS (klien hanya menerima baris yang boleh dibaca).
-- -------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_rooms'
  ) then
    alter publication supabase_realtime add table public.chat_rooms;
  end if;
end $$;
