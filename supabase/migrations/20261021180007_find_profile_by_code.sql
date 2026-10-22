-- =============================================================
-- KLIK Migration 007: find_profile_by_code
-- Klien tidak bisa memilih profiles sembarang (RLS default-deny),
-- padahal send_friend_request(target uuid) butuh uuid target.
-- RPC ini satu-satunya jalan resmi: telusuri kode akun publik
-- (bukan kredensial) -> info dasar untuk permintaan pertemanan.
-- SECURITY DEFINER dibatasi kolom non-sensitif saja:
-- tidak mengembalikan status, waktu, atau kredensial apa pun.
-- =============================================================

create or replace function public.find_profile_by_code(p_code text)
returns table (
  id uuid,
  display_name text,
  public_code text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.public_code, p.avatar_url
  from public.profiles p
  where p.public_code = upper(trim(p_code))
    and p.id <> auth.uid()
  limit 1;
$$;

revoke execute on function public.find_profile_by_code(text) from public, anon;
grant execute on function public.find_profile_by_code(text) to authenticated;
