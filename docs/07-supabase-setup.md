# 07 - Supabase Setup (Milestone 2)

Dokumen ini menjelaskan fondasi backend KLIK yang **sudah diterapkan ke project Supabase nyata**: skema database, kebijakan Row Level Security (RLS), RPC, Edge Functions, dan cara menguji ulang.

| Item | Nilai |
|---|---|
| Project ref | `fkilgzkkzerpuapxfqka` (region Singapore) |
| URL | `https://fkilgzkkzerpuapxfqka.supabase.co` |
| Kredensial frontend | `SUPABASE_URL` + `SUPABASE_ANON_KEY` (di `.env`, tidak di-commit) |
| Service role | hanya di secret Edge Functions (tidak pernah di frontend) |
| Status uji | `node scripts/e2e-supabase.mjs` -> **45/45 lulus** (22 Okt 2026) |

## 1. Alur autentikasi (tanpa email/telepon)

```
Buat akun:
  Klien -> POST /functions/v1/auth-register {display_name, passphrase}
    Edge Function (service role):
      1. buat user Supabase Auth dengan email internal acak
         u-<uuid>@auth.klik.internal
         password = HMAC-SHA256(AUTH_PEPPER, passphrase)
      2. insert profiles (kode publik KLIK-XXXX-XXXX, acak + retry bila tabrakan)
      3. insert account_credentials:
         secret_hash  = PBKDF2(passphrase)        (600.000 iterasi)
         recovery_hash= PBKDF2(recovery key)
      4. signInWithPassword(email internal, password HMAC) -> sesi Supabase Auth
  <- { session, profile, recovery_key }   (recovery_key hanya dikirim 1x)

Masuk:
  Klien -> POST /functions/v1/auth-login {public_code, passphrase}
    1. throttle: 10 kegagalan / 15 menit per kode -> 429
    2. verifikasi PBKDF2(passphrase) terhadap account_credentials
    3. signInWithPassword(email internal, password HMAC) -> sesi
  <- { session, profile }

Pulihkan:
  Klien -> POST /functions/v1/auth-recover {public_code, recovery_key, new_passphrase}
    verifikasi recovery_hash -> rotasi passphrase + recovery key baru
    -> signInWithPassword dengan passphrase baru
  <- { session, profile, recovery_key } (key baru)
```

Setelah sesi ada, **semua akses data memakai JWT Supabase Auth biasa**; RLS membaca `auth.uid()`. Tidak ada JWT custom buatan sendiri.

Fakta penting:

- **Kode akun publik bukan kredensial** - hanya identitas untuk QR/friend request/pencarian.
- **Recovery key disimpan sebagai hash terpisah** (`recovery_hash`), dipakai sekali lalu dirotasi.
- Pesan error login sengaja **sama** untuk "kode tak dikenal" dan "passphrase salah" (tidak membocorkan keberadaan akun).
- Hash format: `pbkdf2$sha256$<iterasi>$<salt_b64>$<hash_b64>`.

## 2. Skema database

Semua migrasi di `supabase/migrations/` (diterapkan berurutan, versi tercatat di `supabase_migrations.schema_migrations`):

| Migrasi | Isi |
|---|---|
| `20261021180001_base_accounts` | `profiles`, `account_credentials`, `login_attempts` + trigger `updated_at` |
| `20261021180002_friends` | `friend_requests`, `friendships` + RPC teman |
| `20261021180003_rooms` | `chat_rooms`, `chat_room_members`, helper RLS, RPC room/konversi |
| `20261021180004_messages` | `messages` (id dihasilkan klien) + indeks cursor |
| `20261021180005_rls_policies` | seluruh policy RLS |
| `20261021180006_storage_realtime` | `device_tokens`, bucket `avatars`, publikasi Realtime |
| `20261021180007_find_profile_by_code` | RPC telusuri kode -> profil dasar |
| `20261021180008_list_my_chats` | RPC `list_my_chats` (daftar room + unread) + `rename_group` (Milestone 4) |

Ringkas kolom kunci:

- `profiles`: `id` (= `auth.users.id`), `display_name`, `public_code` unik (`^KLIK-[A-Z0-9]{4}-[A-Z0-9]{4}$`), `status`, `avatar_url`.
- `account_credentials`: `user_id`, `auth_email` (internal), `secret_hash`, `recovery_hash` - **tanpa policy RLS** (service-role only).
- `login_attempts`: `public_code`, `success`, `attempted_at` - throttle, juga service-role only.
- `friendships`: PK `(user_id_1, user_id_2)` dengan `check user_id_1 < user_id_2` (pasangan terurut -> tanpa relasi ganda).
- `chat_rooms`: `type` `room|group`; riwayat **tidak pernah dipindah** saat konversi privat.
- `messages`: **id = UUID yang dihasilkan klien** -> kirim ulang = conflict -> tidak ada pesan ganda; append-only (tanpa policy update/delete).
- `chat_room_members`: `role` `owner|member|admin`; dibatasi trigger `enforce_member_rules` (room 2 orang = tepat 2 anggota, non-group = tanpa admin).

## 3. RLS (prinsip dan matriks)

Prinsip yang dipakai:

1. **Default-deny**: semua tabel `enable row level security`; tabel tanpa policy tertutup total (dibuktikan oleh uji `account_credentials`/`login_attempts` -> `[]` bahkan untuk user login).
2. **Tulisan lewat SECURITY DEFINER function** - klien tidak punya policy insert/update langsung untuk tabel inti, sehingga validasi (satu-satunya jalur) ada di fungsi.
3. **Anti-recursive helper**: `is_room_member(uuid, uuid)` dan `is_group_admin(uuid, uuid)` dideklarasikan `security definer`, sehingga policy `chat_rooms`/`messages` tidak memicu RLS berantai ke `chat_room_members`.
4. Kolom `profiles` yang boleh di-update klien dibatasi lewat `grant update (display_name, status, avatar_url, updated_at)` - `public_code`/`id` tidak bisa diubah klien.

Matriks baca utama:

| Tabel | Siapa boleh SELECT | Catatan |
|---|---|---|
| `profiles` | diri sendiri, teman, pengirim/penerima request pending, sesama anggota room | pencarian non-teman hanya via `find_profile_by_code` |
| `friend_requests` | pengirim & penerima | daftar permintaan per pihak |
| `friendships` | pihak yang terlibat | |
| `chat_rooms` | anggota room (`is_room_member`) | pihak luar -> `[]` |
| `chat_room_members` | anggota diri sendiri / sesama anggota | |
| `messages` | anggota room | `insert` wajib `sender_id = auth.uid()` + anggota |
| `account_credentials`, `login_attempts` | tidak ada (tutup total) | hanya service role |

## 4. Daftar RPC

| Fungsi | Dari | Fungsi |
|---|---|---|
| `find_profile_by_code(text)` | 007 | kode -> `{id, display_name, public_code, avatar_url}` (kolom sensitif tidak ikut) |
| `send_friend_request(uuid)` | 002 | tolak: diri sendiri, sudah teman, request aktif dua arah |
| `respond_friend_request(uuid, bool)` | 002 | hanya penerima; terima membuat `friendships` + membatalkan request berlawanan |
| `cancel_friend_request(uuid)` | 002 | hanya pengirim, status `pending` |
| `remove_friend(uuid)` | 002 | kedua pihak; bersihkan request pending di antaranya |
| `create_room_with(uuid)` | 003 | idempoten: kembalikan room 2-anggota yang sudah ada bila ada |
| `create_group_room(text, uuid[])` | 003 | semua anggota harus teman |
| `add_room_members` / `remove_room_member` / `set_room_member_role` / `leave_room` | 003 | admin room grup |
| `mark_room_read(uuid)` | 003 | perbarui `last_read_at` (dasar unread) |
| `propose_conversion` / `approve_conversion` / `cancel_conversion` | 003 | konversi grup -> privat, dua tahap, idempoten, butuh persetujuan anggota lain |

Semua RPC `security definer` + `set search_path = public` + cek `auth.uid()`; anon (tanpa JWT) ditolak dengan pesan `Tidak terautentikasi` (SQLSTATE `28000`).

## 5. Edge Functions

Keempatnya memakai bersama `supabase/functions/_shared/` (`cors.ts`, `crypto.ts`, `supabase.ts`, `respond.ts`) dan di-deploy dengan `--no-verify-jwt` (klien memanggil saat belum punya sesi; keamanan ada di dalam badan fungsi).

| Function | Request | Sukses |
|---|---|---|
| `auth-register` | `{display_name, passphrase}` | `201 {session, profile, recovery_key}` |
| `auth-login` | `{public_code, passphrase}` | `200 {session, profile}` |
| `auth-recover` | `{public_code, recovery_key, new_passphrase}` | `200 {session, profile, recovery_key}` |
| `notify-push` | `{message_id}` (butuh `Authorization: Bearer <sesi>`) | `200 {sent, recipients, invalidRemoved}` |

Kode error: `400 VALIDATION` (format salah), `401 INVALID_CREDENTIALS / INVALID_RECOVERY / sesi dibutuhkan` (pesan generik), `403` (bukan pengirim pesan), `429 RATE_LIMITED` (throttle), `500 SERVER` (gagal internal).

Perintah deploy & secret:

```bash
npx supabase secrets set AUTH_PEPPER=<nilai-kuat-random>          # sudah di-set
npx supabase secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat <file>.json)"  # sudah di-set
npx supabase functions deploy auth-register --no-verify-jwt
npx supabase functions deploy auth-login    --no-verify-jwt
npx supabase functions deploy auth-recover  --no-verify-jwt
npx supabase functions deploy notify-push   --no-verify-jwt
```

`AUTH_PEPPER` dipakai untuk menurunkan password akun Supabase Auth internal; jika berubah, semua akun harus di-reset (catat sebagai risiko operasional).

`FCM_SERVICE_ACCOUNT_JSON` = file service account Firebase (Firebase Console -> Project Settings -> Service Accounts) untuk menandatangani JWT RS256 -> access token Google -> kirim FCM HTTP v1. Verifikasi: `npx supabase secrets list` (nilai tidak dibuka). `notify-push` memvalidasi sesi pemanggil via `admin.auth.getUser`, memastikan pemanggil adalah pengirim pesan, lalu mengirim ke semua anggota room **kecuali pengirim** (token yang ditolak FCM dihapus dari `device_tokens`).

## 6. Realtime, Storage, device token

- Publikasi `supabase_realtime` berisi `public.messages` dan `public.chat_rooms` (diverifikasi lewat `pg_publication_tables`). Realtime menghormati RLS, jadi klien hanya menerima baris yang memang berhak dibaca. **Streaming klien belum diuji** (pemakaian `supabase-js` channel ada di Milestone 4).
- Bucket `avatars` (publik dibaca, tulis hanya folder `<auth.uid()>/...` lewat policy `storage.objects`).
- Tabel `device_tokens` (RLS: milik sendiri) untuk push notification Milestone 6.

## 7. Cara menjalankan ulang

```bash
# terapkan migrasi (memakai PAT hasil `npx supabase login`)
node scripts/apply-migrations.mjs

# uji E2E penuh ke project nyata (butuh .env terisi)
node scripts/e2e-supabase.mjs
```

`apply-migrations.mjs` memakai Management API
(`POST /v1/projects/<ref>/database/query`) karena akses password DB tidak
tersedia di mesin ini; jalur resmi `npx supabase db push` tetap valid karena
versi sudah dicatat di `supabase_migrations.schema_migrations`.

Cakupan E2E (41 asersi, semua lulus): register (valid + invalid) -> login
(benar/salah/tak dikenal) -> pencarian kode -> friend request (duplikat,
penolakan non-penerima, pihak luar) -> room idempoten -> pesan (idempoten,
palsukan `sender_id`, isolasi pihak luar, append-only) -> recovery + rotasi
key -> throttle 429 -> penutupan `account_credentials`/`login_attempts`.

## 8. Temuan & perbaikan selama pengujian

1. **SQLSTATE `'401'` tidak valid** - `raise exception ... using errcode = '401'` membuat error `unrecognized exception condition`. Diganti `28000` (invalid authorization specification); file migrasi disesuaikan dan diterapkan ulang.
2. **Normalisasi kode/recovery key** - login awalnya men-strip tanda `-` lalu membandingkan dengan kolom yang menyimpan format berkait (`KLIK-XXXX-XXXX`), sehingga lookup gagal. Kini `normalizeAccountCode`/`normalizeRecoveryKey` merakit ulang format kanonik, dan regex recovery key diperbaiki dari `{12}` menjadi `{16}` karakter isi.
3. **Pencarian teman** - `send_friend_request(target uuid)` butuh uuid, tetapi RLS menutup baca `profiles` sembarang; ditambahkan `find_profile_by_code` (SECURITY DEFINER, kolom terbatas) sebagai satu-satunya jalan resmi.

## 9. Batas yang diakui (jujur)

- Frontend **belum tersambung** ke Supabase - `src/services/*` masih data dummy (pemasangan klien & auth UI = Milestone 3).
- Streaming Realtime, upload avatar, dan push token **belum diuji** (Milestone 4/6).
- `npm test` (28/28) dan `npm run check` (34/34) tidak menyentuh kode Supabase; bukti backend hanya dari E2E HTTP di atas.
- Pengujian dilakukan dari satu mesin; perilaku di jaringan/JWT expiry panjang belum diuji.
