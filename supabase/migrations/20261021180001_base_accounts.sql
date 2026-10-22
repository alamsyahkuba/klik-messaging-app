-- =============================================================
-- KLIK Migration 001: profiles, account_credentials, login_attempts
-- Strategi autentikasi (docs/02):
--   - profiles.id = auth.users.id (dibuat oleh Edge Function via service role)
--   - public_code: identitas publik untuk QR/friend request, BUKAN kredensial
--   - account_credentials: hash passphrase (PBKDF2-SHA256) + hash recovery key
--     HANYA bisa dibaca/ditulis service role (tanpa policy = RLS menolak client)
--   - auth_email: email internal acak u-<uuid>@auth.klik.internal untuk memetakan
--     kredensial ke sesi Supabase Auth (password = HMAC(pepper, passphrase))
-- =============================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------
-- profiles
-- -------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 30),
  public_code  text not null unique check (public_code ~ '^KLIK-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  status       text not null default '' check (char_length(status) <= 80),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- account_credentials (service-role only)
-- Format secret_hash / recovery_hash:
--   pbkdf2$sha256$<iterations>$<salt_base64>$<hash_base64>
-- -------------------------------------------------------------
create table if not exists public.account_credentials (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  auth_email        text not null unique,
  secret_hash       text not null,
  recovery_hash     text not null,
  secret_updated_at timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

-- -------------------------------------------------------------
-- login_attempts (throttling sederhana, service-role only)
-- -------------------------------------------------------------
create table if not exists public.login_attempts (
  id          bigint generated always as identity primary key,
  public_code text not null,
  success     boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists login_attempts_code_time_idx
  on public.login_attempts (public_code, attempted_at desc);

-- RLS aktif tanpa policy = client tidak bisa membaca/menulis sama sekali
alter table public.profiles enable row level security;
alter table public.account_credentials enable row level security;
alter table public.login_attempts enable row level security;
