-- =============================================================
-- KLIK Migration 002: friend_requests, friendships + RPC
-- Aturan:
--   - permintaan hanya boleh dikirim/diubah oleh pihak yang berwenang
--     (dijalankan lewat SECURITY DEFINER function -> satu jalur validasi)
--   - permintaan duplikat & permintaan berlawanan dicegah
--   - friendships disimpan sebagai pasangan terurut (user_id_1 < user_id_2)
--     agar tidak ada relasi ganda
-- =============================================================

create table if not exists public.friend_requests (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at  timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_no_self check (sender_id <> receiver_id)
);

create unique index if not exists friend_requests_pending_uniq
  on public.friend_requests (sender_id, receiver_id)
  where status = 'pending';

create index if not exists friend_requests_receiver_pending_idx
  on public.friend_requests (receiver_id) where status = 'pending';

create index if not exists friend_requests_sender_pending_idx
  on public.friend_requests (sender_id) where status = 'pending';

create table if not exists public.friendships (
  user_id_1  uuid not null references public.profiles (id) on delete cascade,
  user_id_2  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id_1, user_id_2),
  constraint friendships_ordered check (user_id_1 < user_id_2)
);

create index if not exists friendships_user2_idx on public.friendships (user_id_2);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;

-- -------------------------------------------------------------
-- RPC: kirim permintaan pertemanan
-- -------------------------------------------------------------
create or replace function public.send_friend_request(target uuid)
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
    raise exception 'Tidak bisa menambahkan diri sendiri' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'Akun tidak ditemukan' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.friendships f
    where (f.user_id_1 = uid and f.user_id_2 = target)
       or (f.user_id_1 = target and f.user_id_2 = uid)
  ) then
    raise exception 'Orang ini sudah menjadi temanmu' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.friend_requests fr
    where fr.status = 'pending'
      and ((fr.sender_id = uid and fr.receiver_id = target)
        or (fr.sender_id = target and fr.receiver_id = uid))
  ) then
    raise exception 'Masih ada permintaan pertemanan aktif di antara kalian' using errcode = 'P0001';
  end if;

  insert into public.friend_requests (sender_id, receiver_id)
  values (uid, target)
  returning id into rid;

  return rid;
end;
$$;

-- -------------------------------------------------------------
-- RPC: terima / tolak permintaan (hanya penerima)
-- -------------------------------------------------------------
create or replace function public.respond_friend_request(request_id uuid, accept boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  req public.friend_requests%rowtype;
  lo uuid;
  hi uuid;
begin
  if uid is null then
    raise exception 'Tidak terautentikasi' using errcode = '28000';
  end if;

  select * into req from public.friend_requests where id = request_id for update;
  if not found then
    raise exception 'Permintaan tidak ditemukan' using errcode = 'P0001';
  end if;
  if req.receiver_id <> uid then
    raise exception 'Bukan penerima permintaan ini' using errcode = '42501';
  end if;
  if req.status <> 'pending' then
    raise exception 'Permintaan sudah diproses' using errcode = 'P0001';
  end if;

  update public.friend_requests
  set status = case when accept then 'accepted' else 'rejected' end,
      responded_at = now()
  where id = request_id;

  if accept then
    lo := least(req.sender_id, req.receiver_id);
    hi := greatest(req.sender_id, req.receiver_id);
    insert into public.friendships (user_id_1, user_id_2)
    values (lo, hi)
    on conflict do nothing;

    -- permintaan berlawanan yang masih pending dibatalkan otomatis
    update public.friend_requests
    set status = 'cancelled', responded_at = now()
    where status = 'pending'
      and sender_id = req.receiver_id
      and receiver_id = req.sender_id;
  end if;

  return case when accept then
    case when req.sender_id = uid then req.receiver_id else req.sender_id end
  else null end;
end;
$$;

-- -------------------------------------------------------------
-- RPC: batalkan permintaan keluar (hanya pengirim, status pending)
-- -------------------------------------------------------------
create or replace function public.cancel_friend_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  req public.friend_requests%rowtype;
begin
  if uid is null then
    raise exception 'Tidak terautentikasi' using errcode = '28000';
  end if;
  select * into req from public.friend_requests where id = request_id for update;
  if not found then
    raise exception 'Permintaan tidak ditemukan' using errcode = 'P0001';
  end if;
  if req.sender_id <> uid then
    raise exception 'Bukan pengirim permintaan ini' using errcode = '42501';
  end if;
  if req.status <> 'pending' then
    raise exception 'Permintaan sudah diproses' using errcode = 'P0001';
  end if;
  update public.friend_requests set status = 'cancelled', responded_at = now() where id = request_id;
end;
$$;

-- -------------------------------------------------------------
-- RPC: hapus teman (kedua pihak; permintaan pending antara keduanya dibersihkan)
-- -------------------------------------------------------------
create or replace function public.remove_friend(other uuid)
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
  if other = uid then
    raise exception 'Tidak valid' using errcode = 'P0001';
  end if;

  delete from public.friendships
  where (user_id_1 = least(uid, other) and user_id_2 = greatest(uid, other));

  update public.friend_requests
  set status = 'cancelled', responded_at = now()
  where status = 'pending'
    and ((sender_id = uid and receiver_id = other) or (sender_id = other and receiver_id = uid));
end;
$$;
