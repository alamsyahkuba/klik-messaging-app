-- =============================================================
-- KLIK Migration 009: device_tokens.settings (preferensi notif per perangkat)
--   Dipakai Edge Function notify-push: messagePreview=false -> body "Pesan baru".
--   + policy UPDATE own (klien hanya boleh mengubah settings miliknya sendiri).
-- =============================================================

alter table public.device_tokens
  add column if not exists settings jsonb not null default '{}';

drop policy if exists "device_tokens_update_own" on public.device_tokens;
create policy "device_tokens_update_own"
  on public.device_tokens for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
