-- =============================================================
-- KLIK Migration 003: chat_rooms, chat_room_members + RPC
-- Tipe room:
--   'room'   : ruang percakapan biasa (bisa dikonversi menjadi private)
--   'private': tepat 2 anggota, hasil konversi (lihat propose/approve_conversion)
--   'group'  : grup dengan role owner/admin/member
-- Semua operasi tulis lewat SECURITY DEFINER function (satu jalur validasi).
-- =============================================================

create table if not exists public.chat_rooms (
  id                   uuid primary key default gen_random_uuid(),
  type                 text not null default 'room'
                       check (type in ('room', 'private', 'group')),
  name                 text check (name is null or char_length(btrim(name)) between 3 and 60),
  created_by           uuid references public.profiles (id) on delete set null,
  conversion_state     text not null default 'none'
                       check (conversion_state in ('none', 'proposed')),
  conversion_proposed_by uuid references public.profiles (id) on delete set null,
  conversion_proposed_at timestamptz,
  created_at           timestamptz not null default now(),
  converted_at         timestamptz,
  constraint group_requires_name check (type <> 'group' or name is not null),
  constraint private_has_no_name check (type <> 'private' or name is null)
);

create table if not exists public.chat_room_members (
  room_id      uuid not null references public.chat_rooms (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at    timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists chat_room_members_user_idx
  on public.chat_room_members (user_id, joined_at desc);

create index if not exists chat_room_members_room_idx
  on public.chat_room_members (room_id);

alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;

-- -------------------------------------------------------------
-- Helper otorisasi (dipakai RLS policies; SECURITY DEFINER -> anti recursive RLS)
-- -------------------------------------------------------------
create or replace function public.is_room_member(p_room uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_room_members
    where room_id = p_room and user_id = p_user
  );
$$;

create or replace function public.is_group_admin(p_room uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_room_members
    where room_id = p_room and user_id = p_user and role in ('owner', 'admin')
  );
$$;

-- -------------------------------------------------------------
-- Trigger: jaga aturan anggota
--   - private room tidak boleh menerima anggota baru
--   - non-grup tidak boleh kehilangan anggota satu-satu (pakai leave_room)
--   - grup yang kehilangan anggota terakhir otomatis terhapus
-- -------------------------------------------------------------
create or replace function public.enforce_member_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r_type text;
begin
  if tg_op = 'INSERT' then
    select type into r_type from public.chat_rooms where id = new.room_id;
    if r_type = 'private' then
      raise exception 'Chat privat hanya memiliki dua anggota' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    select type into r_type from public.chat_rooms where id = old.room_id;
    if r_type is null then
      return old; -- room terhapus lewat cascade
    end if;
    if r_type <> 'group' then
      raise exception 'Gunakan fungsi leave_room untuk room non-grup' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.chat_room_members where room_id = old.room_id) then
      delete from public.chat_rooms where id = old.room_id;
    end if;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists chat_room_members_rules on public.chat_room_members;
create trigger chat_room_members_rules
  before insert or delete on public.chat_room_members
  for each row execute function public.enforce_member_rules();

-- -------------------------------------------------------------
-- RPC: buat atau pakai ulang percakapan 2 orang dengan teman
-- -------------------------------------------------------------
create or replace function public.create_room_with(target uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rid uuid;
begin
  if uid is null then
    raise exception 'Tidak terautentikasi' using errcode = '28000';
  end if;
  if target = uid then
    raise exception 'Tidak bisa membuat percakapan dengan diri sendiri' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.friendships f
    where (f.user_id_1 = least(uid, target) and f.user_id_2 = greatest(uid, target))
  ) then
    raise exception 'Hanya teman yang bisa memulai percakapan' using errcode = '42501';
  end if;

  select r.id into rid
  from public.chat_rooms r
  where r.type <> 'group'
    and (select count(*) from public.chat_room_members m where m.room_id = r.id) = 2
    and exists (select 1 from public.chat_room_members m where m.room_id = r.id and m.user_id = uid)
    and exists (select 1 from public.chat_room_members m where m.room_id = r.id and m.user_id = target)
  limit 1;

  if rid is not null then
    return rid;
  end if;

  insert into public.chat_rooms (type, created_by)
  values ('room', uid)
  returning id into rid;

  insert into public.chat_room_members (room_id, user_id, role)
  values (rid, uid, 'owner'), (rid, target, 'member');

  return rid;
end;
$$;

-- -------------------------------------------------------------
-- RPC: buat grup (minimal 1 anggota lain, semua harus teman)
-- -------------------------------------------------------------
create or replace function public.create_group_room(group_name text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rid uuid;
  clean_name text;
  targets uuid[];
  m uuid;
begin
  if uid is null then
    raise exception 'Tidak terautentikasi' using errcode = '28000';
  end if;

  clean_name := btrim(coalesce(group_name, ''));
  if char_length(clean_name) not between 3 and 60 then
    raise exception 'Nama grup harus 3-60 karakter' using errcode = '22023';
  end if;

  select array_agg(distinct x) into targets
  from unnest(coalesce(member_ids, array[]::uuid[])) x
  where x is not null and x <> uid;

  if targets is null or array_length(targets, 1) is null then
    raise exception 'Pilih minimal satu anggota lain' using errcode = '22023';
  end if;
  if array_length(targets, 1) > 99 then
    raise exception 'Maksimal 99 anggota' using errcode = '22023';
  end if;

  foreach m in array targets loop
    if not exists (
      select 1 from public.friendships f
      where (f.user_id_1 = least(uid, m) and f.user_id_2 = greatest(uid, m))
    ) then
      raise exception 'Semua anggota grup harus menjadi temanmu' using errcode = '42501';
    end if;
  end loop;

  insert into public.chat_rooms (type, name, created_by)
  values ('group', clean_name, uid)
  returning id into rid;

  insert into public.chat_room_members (room_id, user_id, role)
  values (rid, uid, 'owner');

  insert into public.chat_room_members (room_id, user_id, role)
  select rid, x, 'member' from unnest(targets) x;

  return rid;
end;
$$;

-- -------------------------------------------------------------
-- RPC: tambah anggota (hanya grup, hanya admin)
-- -------------------------------------------------------------
create or replace function public.add_room_members(p_room uuid, p_members uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r_type text;
  added int := 0;
  m uuid;
begin
  select type into r_type from public.chat_rooms where id = p_room for update;
  if r_type is null then
    raise exception 'Room tidak ditemukan' using errcode = 'P0001';
  end if;
  if r_type <> 'group' then
    raise exception 'Hanya grup yang bisa menambah anggota' using errcode = 'P0001';
  end if;
  if not public.is_group_admin(p_room, uid) then
    raise exception 'Hanya admin yang dapat menambah anggota' using errcode = '42501';
  end if;

  foreach m in array coalesce(p_members, array[]::uuid[]) loop
    if m is null or m = uid then
      continue;
    end if;
    if exists (select 1 from public.chat_room_members where room_id = p_room and user_id = m) then
      continue;
    end if;
    if not exists (
      select 1 from public.friendships f
      where (f.user_id_1 = least(uid, m) and f.user_id_2 = greatest(uid, m))
    ) then
      raise exception 'Hanya teman yang bisa ditambahkan ke grup' using errcode = '42501';
    end if;
    insert into public.chat_room_members (room_id, user_id) values (p_room, m);
    added := added + 1;
  end loop;

  return added;
end;
$$;

-- -------------------------------------------------------------
-- RPC: keluarkan anggota (hanya grup, admin, tidak untuk owner)
-- -------------------------------------------------------------
create or replace function public.remove_room_member(p_room uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r_type text;
  target_role text;
begin
  select type into r_type from public.chat_rooms where id = p_room for update;
  if r_type is null or r_type <> 'group' then
    raise exception 'Hanya grup' using errcode = 'P0001';
  end if;
  if not public.is_group_admin(p_room, uid) then
    raise exception 'Hanya admin yang dapat mengeluarkan anggota' using errcode = '42501';
  end if;
  if p_target = uid then
    raise exception 'Gunakan leave_room untuk diri sendiri' using errcode = 'P0001';
  end if;

  select role into target_role from public.chat_room_members
  where room_id = p_room and user_id = p_target for update;
  if target_role is null then
    raise exception 'Anggota tidak ditemukan' using errcode = 'P0001';
  end if;
  if target_role = 'owner' then
    raise exception 'Owner tidak bisa dikeluarkan' using errcode = '42501';
  end if;

  delete from public.chat_room_members where room_id = p_room and user_id = p_target;
end;
$$;

-- -------------------------------------------------------------
-- RPC: ubah role (owner: admin<->member; admin: promosi member->admin)
-- -------------------------------------------------------------
create or replace function public.set_room_member_role(p_room uuid, p_target uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r_type text;
  caller_role text;
  target_role text;
begin
  if p_role not in ('admin', 'member') then
    raise exception 'Role tidak valid' using errcode = '22023';
  end if;
  select type into r_type from public.chat_rooms where id = p_room for update;
  if r_type is null or r_type <> 'group' then
    raise exception 'Hanya grup' using errcode = 'P0001';
  end if;

  select role into caller_role from public.chat_room_members
  where room_id = p_room and user_id = uid for update;
  select role into target_role from public.chat_room_members
  where room_id = p_room and user_id = p_target for update;

  if target_role is null then
    raise exception 'Anggota tidak ditemukan' using errcode = 'P0001';
  end if;
  if caller_role not in ('owner', 'admin') then
    raise exception 'Hanya admin yang dapat mengubah role' using errcode = '42501';
  end if;
  if p_role = 'member' and caller_role <> 'owner' then
    raise exception 'Hanya owner yang dapat menurunkan admin' using errcode = '42501';
  end if;

  update public.chat_room_members
  set role = p_role
  where room_id = p_room and user_id = p_target;
end;
$$;

-- -------------------------------------------------------------
-- RPC: keluar dari room
--   - grup: owner yang keluar -> admin tertua tersisa dipromosikan jadi owner
--   - non-grup (room/private 2 anggota): room dihapus untuk kedua anggota
--     (dokumentasikan di docs/04 & docs/05)
-- -------------------------------------------------------------
create or replace function public.leave_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r_type text;
  my_role text;
  next_owner uuid;
begin
  select type into r_type from public.chat_rooms where id = p_room for update;
  if r_type is null then
    raise exception 'Room tidak ditemukan' using errcode = 'P0001';
  end if;

  select role into my_role from public.chat_room_members
  where room_id = p_room and user_id = uid for update;
  if my_role is null then
    raise exception 'Kamu bukan anggota room ini' using errcode = '42501';
  end if;

  if r_type <> 'group' then
    delete from public.chat_rooms where id = p_room;
    return;
  end if;

  delete from public.chat_room_members where room_id = p_room and user_id = uid;

  if my_role = 'owner' then
    if exists (select 1 from public.chat_room_members where room_id = p_room and role = 'owner') then
      return;
    end if;
    if exists (select 1 from public.chat_room_members where room_id = p_room and role = 'admin') then
      return; -- admin tersisa menjalankan grup
    end if;
    select user_id into next_owner
    from public.chat_room_members
    where room_id = p_room
    order by joined_at asc
    limit 1;
    if next_owner is not null then
      update public.chat_room_members set role = 'owner' where room_id = p_room and user_id = next_owner;
    end if;
  end if;
end;
$$;

-- -------------------------------------------------------------
-- RPC: tandai room sudah dibaca
-- -------------------------------------------------------------
create or replace function public.mark_room_read(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Tidak terautentikasi' using errcode = '28000';
  end if;
  update public.chat_room_members
  set last_read_at = greatest(last_read_at, now())
  where room_id = p_room and user_id = uid;
end;
$$;

-- -------------------------------------------------------------
-- RPC: konversi room -> chat privat (dua tahap, persetujuan kedua anggota)
--   1. propose_conversion : oleh salah satu anggota
--   2. approve_conversion : oleh ANGGOTA LAIN (atomik & idempoten)
-- Syarat: tepat 2 anggota, keduanya berteman, room bertipe 'room'.
-- Riwayat pesan TIDAK dipindah/dihapus; konversi permanen.
-- -------------------------------------------------------------
create or replace function public.propose_conversion(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r record;
begin
  select * into r from public.chat_rooms where id = p_room for update;
  if not found then
    raise exception 'Room tidak ditemukan' using errcode = 'P0001';
  end if;
  if not public.is_room_member(p_room, uid) then
    raise exception 'Kamu bukan anggota room ini' using errcode = '42501';
  end if;
  if r.type = 'private' then
    raise exception 'Percakapan ini sudah bersifat privat' using errcode = 'P0001';
  end if;
  if r.type = 'group' then
    raise exception 'Grup tidak dapat diubah menjadi chat privat' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chat_room_members where room_id = p_room) <> 2 then
    raise exception 'Konversi hanya bisa dilakukan pada room dengan tepat 2 anggota' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.chat_room_members a
    join public.chat_room_members b on b.room_id = a.room_id and b.user_id <> a.user_id
    join public.friendships f on (f.user_id_1 = least(a.user_id, b.user_id) and f.user_id_2 = greatest(a.user_id, b.user_id))
    where a.room_id = p_room and a.user_id = uid
  ) then
    raise exception 'Kedua anggota harus berteman untuk mengonversi room' using errcode = '42501';
  end if;

  update public.chat_rooms
  set conversion_state = 'proposed',
      conversion_proposed_by = uid,
      conversion_proposed_at = now()
  where id = p_room;
end;
$$;

create or replace function public.approve_conversion(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r record;
begin
  select * into r from public.chat_rooms where id = p_room for update;
  if not found then
    raise exception 'Room tidak ditemukan' using errcode = 'P0001';
  end if;
  if not public.is_room_member(p_room, uid) then
    raise exception 'Kamu bukan anggota room ini' using errcode = '42501';
  end if;
  if r.type = 'private' then
    return; -- idempoten
  end if;
  if r.type <> 'room' then
    raise exception 'Grup tidak dapat diubah menjadi chat privat' using errcode = 'P0001';
  end if;
  if r.conversion_state <> 'proposed' then
    raise exception 'Belum ada permintaan konversi pada room ini' using errcode = 'P0001';
  end if;
  if r.conversion_proposed_by = uid then
    raise exception 'Menunggu persetujuan anggota lain' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chat_room_members where room_id = p_room) <> 2 then
    raise exception 'Konversi hanya bisa dilakukan pada room dengan tepat 2 anggota' using errcode = 'P0001';
  end if;

  update public.chat_rooms
  set type = 'private',
      conversion_state = 'none',
      conversion_proposed_by = null,
      conversion_proposed_at = null,
      converted_at = now()
  where id = p_room;
end;
$$;

create or replace function public.cancel_conversion(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if not public.is_room_member(p_room, uid) then
    raise exception 'Kamu bukan anggota room ini' using errcode = '42501';
  end if;
  update public.chat_rooms
  set conversion_state = 'none', conversion_proposed_by = null, conversion_proposed_at = null
  where id = p_room and conversion_state = 'proposed';
end;
$$;
