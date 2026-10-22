# 02 - Account & Friends (Milestone 3)

Milestone ini menyambungkan frontend KLIK ke backend Supabase yang sudah dibangun di Milestone 2 (docs/07): akun nyata (buat/masuk/pulih/keluar), profil nyata, dan pertemanan nyata (cari kode, request, terima/tolak, hapus). UI tetap memakai service layer yang sama seperti Milestone 1 sehingga halaman tidak berubah bentuk.

| Item | Nilai |
|---|---|
| Status uji | `node scripts/e2e-services.mjs` -> **18/18 lulus** (live, via happy-dom + vendor UMD) |
| Regresi | `npm test` 28/28, `npm run check` 34/34 |
| Lanjutan | `chats-service` live (rooms + messages) = Milestone 4, lihat docs/04 |

## 1. Cara kerja mode live vs demo

Tanpa bundler, library Supabase dimuat sebagai **UMD**:

```
index.html
  <script src="vendor/supabase.js"></script>   <!-- window.supabase -->
  <script type="module" src="src/main.js"></script>
```

- `npm run sync:env` menyalin build UMD dari `node_modules/@supabase/supabase-js` ke `vendor/` **dan** menghasilkan `src/config.js` dari `.env` (`SUPABASE_URL` + `SUPABASE_ANON_KEY` saja - anon key memang dirancang publik; service role tidak pernah masuk frontend).
- `src/services/supabase.js` membuat instance client (lazy) via `window.supabase.createClient`.
- `isLive()` = config terisi **dan** berjalan di browser (bukan Node). Di Node (uji otomatis) semua service otomatis memakai **jalur demo** persis seperti Milestone 1 - inilah yang membuat 25 smoke test tetap lulus tanpa jaringan.
- Fitur **state preview** (`?state=loading|error|empty`) tetap berfungsi di mode live: service memakai data dummy + `respond()` tanpa menyentuh jaringan.
- Guard rute: di mode live, membuka `#/app/*` tanpa sesi akan dialihkan ke `#/login` (`guardSession` di `src/main.js`).

## 2. auth-service (`src/services/auth-service.js`)

| Fungsi | Live (Edge Function) | Demo (Node) |
|---|---|---|
| `registerAccount({displayName, passphrase})` | `auth-register` -> setSession -> `{profile, recoveryKey}` | identitas lokal + mutasi dummy `me` |
| `loginWithPassphrase({publicCode, passphrase})` | `auth-login` -> setSession -> `{profile}` | selalu berhasil |
| `recoverAccount({publicCode, recoveryKey, newPassphrase})` | `auth-recover` -> rotasi key -> setSession | key dummy baru |
| `currentSession()` / `currentUserId()` | `supabase.auth.getSession()` | selalu "ada" (uji) |
| `logout()` | `supabase.auth.signOut()` | hapus salinan lokal |

Catatan desain:

- Sesi disimpan supabase-js di `localStorage` (persist + auto refresh).
- **Recovery key**: server hanya menyimpan hash-nya. Salinan plaintext disimpan di `localStorage` perangkat (`klik.recovery_key`) **hanya** agar halaman profil bisa menampilkan ulang key yang baru dibuat/dipulihkan di perangkat itu. Bila salinan hilang, profil menampilkan penjelasan bahwa key tidak bisa dikirim ulang (jujur, tidak menjanjikan hal yang mustahil).
- Halaman `create-account` kini punya kolom **passphrase + konfirmasi** (backend tidak menerima akun tanpa passphrase).
- Halaman `login` punya **form pemulihan nyata** di modal "Lupa passphrase?" (kode + recovery key + passphrase baru) yang memanggil `recoverAccount`.

## 3. friends-service & profile-service

Pemetaan ke backend (lihat docs/07 untuk detail RLS/RPC):

| Fungsi service | Backend |
|---|---|
| `listFriends` | `friendships` (milik sendiri) + `profiles` |
| `listIncoming` / `listOutgoing` | `friend_requests` pending di pihak sendiri + `profiles` |
| `findByCode` | RPC `find_profile_by_code` + pengecekan teman/request + cek kode sendiri (SELF_ADD) |
| `sendRequest` / `cancelRequest` / `acceptRequest` / `rejectRequest` / `removeFriend` | RPC friends (security definer) |
| `getFriend` | `profiles` + `friendships` (isFriend, `created_at`) |
| `getProfile` / `updateDisplayName` | `profiles` (RLS milik sendiri) |
| `recoveryInfo` | kode dari profil live; key dari penyimpanan lokal |
| `subscribePresence` (`presence-service.js`) | channel Realtime Presence `klik-presence` (key = uid) - status Online/Offline |

Penting: kode akun harus dikirim dalam **format kanonik berkait** `KLIK-XXXX-XXXX` ke RPC (DB menyimpan begitu). Helper `formatAccountCode` di `src/utils/id.js` merakit ulang format itu dari input pengguna yang longgar (spasi/strip/huruf kecil). Bug format ini pernah membuat pencarian teman gagal "tidak ditemukan" dan sudah diuji balik lewat `scripts/e2e-services.mjs`.

### Teman sejak & status Online/Offline

- `liveListFriends` / `getFriend` menyertakan **`friendSince`** (tanggal `friendships.created_at`) -> modal teman menampilkan "Teman sejak <tanggal>" (fallback teks lama bila belum ada). Mode demo memakai tanggal dari `dummy.js`.
- Status **Online** memakai Supabase Realtime **Presence**: `presence-service` me-track sesi sendiri (`startPresence` dipanggil `main.js` saat login) dan semua halaman (Teman, daftar chat, header chat) berlangganan `subscribePresence` -> render ulang saat ada yang join/leave. Subtitle "Online/Offline" di daftar chat + header memakai `peerSubtitle`/`isOnline` dengan cache snapshot terakhir.

## 4. QR asli (progressive enhancement)

`qrFrame(seed, { real: true })` tetap merender placeholder lebih dulu, lalu mencoba menggambar QR asli di `<canvas>` memakai pustaka `qrcode` yang dimuat dari CDN (`esm.sh`) lewat dynamic import. Caption dinamis: sukses -> "QR kode akun. Pindai untuk menambahkan teman."; gagal/offline -> "QR asli gagal dimuat (offline?). Pola di atas bukan QR yang bisa dipindai." Pemindaian QR kamera di Milestone 6 (Capacitor ML Kit + fallback BarcodeDetector API, `scanner-service.js`); di web tanpa BarcodeDetector tersedia input kode manual.

## 5. Cara menjalankan & menguji

```bash
npm install
npm run sync:env      # vendor/ + src/config.js dari .env
npm run dev           # http://localhost:5173 - uji manual dengan akun nyata
npm run check         # 36/36 modul
npm test              # 28/28 (mode demo, tanpa jaringan)
node scripts/e2e-supabase.mjs   # 45/45 - API mentah (Edge Functions + RLS + notify-push), Milestone 2
node scripts/e2e-services.mjs   # 18/18 - service layer live via happy-dom, Milestone 3
```

Alur uji manual yang disarankan: buat 2 akun di 2 browser/profil berbeda -> catat kode & recovery key -> tambah teman via kode -> terima -> mulai chat (chat live = Milestone 4, docs/04).

## 6. Batas yang diakui (jujur)

- Belum diuji di browser sungguhan/WebView dari mesin ini; bukti otomatis = smoke test demo + E2E service live (happy-dom).
- QR asli bergantung CDN; offline hanya placeholder + caption jujur (pemindaian kamera: lihat docs/10).
- Notifikasi/badge unread realtime di browser nyata belum diverifikasi manual (service live sudah diuji di Milestone 4).
