-- =============================================================
-- KLIK Migration 008: list_my_chats + rename_group (Milestone 4)
-- list_my_chats: satu query untuk daftar percakapan milik caller
--   (judul, anggota, pesan terakhir, unread) - menghindari N+1 di klien.
-- rename_group : tidak ada RPC rename di migrasi 003; tambahkan di sini.
-- =============================================================

create or replace function public.list_my_chats()
returns table (
  room_id uuid,
  room_type text,
  room_name text,
  room_created_by uuid,
  room_created_at timestamptz,
  conversion_state text,
  conversion_proposed_by uuid,
  conversion_proposed_at timestamptz,
  member_ids uuid[],
  my_role text,
  last_message_id uuid,
  last_message_body text,
  last_message_sender uuid,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.type,
    r.name,
    r.created_by,
    r.created_at,
    r.conversion_state,
    r.conversion_proposed_by,
    r.conversion_proposed_at,
    agg.member_ids,
    mr.role,
    lm.id,
    lm.body,
    lm.sender_id,
    lm.created_at,
    (
      select count(*)
      from public.messages m
      where m.room_id = r.id
        and m.created_at > mr.last_read_at
        and m.sender_id <> mr.user_id
    )::bigint
  from public.chat_room_members mr
  join public.chat_rooms r on r.id = mr.room_id
  cross join lateral (
    select array_agg(x.user_id) as member_ids
    from public.chat_room_members x
    where x.room_id = r.id
  ) agg
  left join lateral (
    select m2.id, m2.body, m2.sender_id, m2.created_at
    from public.messages m2
    where m2.room_id = r.id
    order by m2.created_at desc, m2.id desc
    limit 1
  ) lm on true
  where mr.user_id = auth.uid()
  order by coalesce(lm.created_at, r.created_at) desc;
$$;

revoke execute on function public.list_my_chats() from public, anon;
grant execute on function public.list_my_chats() to authenticated;

-- -------------------------------------------------------------
-- rename_group: ubah nama grup (hanya owner/admin)
-- -------------------------------------------------------------
create or replace function public.rename_group(p_room uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  clean text := btrim(coalesce(p_name, ''));
begin
  if uid is null then
    raise exception 'Tidak terautentikasi' using errcode = '28000';
  end if;
  if char_length(clean) not between 3 and 60 then
    raise exception 'Nama grup harus 3-60 karakter' using errcode = '22023';
  end if;
  if not exists (select 1 from public.chat_rooms where id = p_room and type = 'group') then
    raise exception 'Hanya grup yang bisa diganti nama' using errcode = 'P0001';
  end if;
  if not public.is_group_admin(p_room, uid) then
    raise exception 'Hanya admin yang dapat mengubah nama grup' using errcode = '42501';
  end if;
  update public.chat_rooms set name = clean where id = p_room;
end;
$$;
