# 00 - Project Overview

**Status: Implemented (Milestone 1-5) / Tested (otomatis + E2E live) / Visual manual: belum**

Terakhir diperbarui: Milestone 5 (Group Chat).

## 1. Tujuan

Aplikasi chatting yang:

- Berjalan sebagai **web app**, **Android** (Capacitor), dan **iOS** (Capacitor, bila lingkungan mendukung).
- Memakai akun **tanpa email dan nomor telepon**.
- Memiliki chat privat, room biasa, dan grup dengan **Supabase Realtime**.
- Responsif (desktop: sidebar + daftar + panel chat; mobile: halaman terpisah + bottom nav).
- Konsisten secara visual dengan design system **Neobrutalism**.

## 2. Stack Teknologi

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Struktur | HTML5 | Wajib, tanpa framework |
| Styling | CSS3 + custom properties | Design token di `src/styles/tokens.css` |
| Logika | Vanilla JavaScript ES Modules | Wajib; tanpa React/Vue/Angular |
| Routing | Hash router sendiri (`src/router/router.js`) | Kecil, tanpa dependency, cocok untuk WebView Capacitor |
| Native | Capacitor 6 | Wajib untuk Android/iOS |
| Backend | Supabase (PostgreSQL, Realtime, Storage, Edge Functions) | Wajib, free tier |
| Autentikasi | Edge Function -> sesi Supabase Auth | Lihat docs/02 (Milestone 3) |
| QR generate | `qrcode` (npm) | Murni JS, ringan, jalan di browser & WebView |
| QR scan | `@capacitor-mlkit/barcode-scanning` (native) + fallback input kode manual | ML Kit cepat & offline; fallback web memakai Barcode Detector API bila tersedia |
| Storage lokal | `localStorage` (preferensi) + IndexedDB (antrean pesan, Milestone 4) | Minimal, privat |

**Dependency runtime saat ini:** `@supabase/supabase-js`, `@capacitor/core`, `qrcode`.
**Dependency dev:** `@capacitor/cli`, `happy-dom` (pengujian DOM headless).

## 3. Arsitektur

```
┌─────────────────────────────────────────────────────┐
│ index.html                                          │
│  └── src/main.js (registrasi route, tema, viewport) │
│       └── router/router.js (hash: #/app/...)        │
│            └── pages/*.js (render + koordinasi)     │
│                 ├── components/* (UI reusable)      │
│                 ├── services/* (akses data + error) │
│                 │     └── data/dummy.js  (M1)       │
│                 │     └── supabase-js    (M3+)      │
│                 └── utils/* (dom, waktu, id, dll)   │
└─────────────────────────────────────────────────────┘
```

Prinsip pemisahan:

- **Pages** hanya mengatur layout, state halaman, dan memanggil service.
- **Services** satu-satunya tempat akses data; mengembalikan Promise dan melempar `ServiceError` berisi pesan siap tampilkan. Penggantian dummy -> Supabase tidak mengubah halaman.
- **Components** tidak bergantung pada halaman tertentu.
- Semua file JS adalah ES Module; tidak ada top-level akses DOM (diverifikasi `npm run check`).

## 4. Struktur Folder

```
project-root/
├── index.html
├── package.json
├── capacitor.config.ts
├── .env.example
├── .gitignore
├── README.md
├── src/
│   ├── assets/logo.svg
│   ├── styles/ tokens.css reset.css global.css components.css responsive.css
│   ├── components/ icon avatar toast modal state-view message-bubble chat-list qr-preview
│   ├── pages/ welcome create-account login home friends chat profile _shell
│   ├── services/ _fake supabase auth-service chats-service friends-service profile-service
│   ├── data/dummy.js
│   ├── utils/ dom format-time id preferences viewport offline-queue
│   ├── router/router.js
│   └── main.js
├── vendor/ supabase.js (hasil npm run sync:env, gitignored)
├── scripts/ check-syntax build-dist sync-env apply-migrations e2e-supabase e2e-services e2e-chat
├── supabase/ 8 migrasi SQL + functions (auth-register/login/recover + _shared)
├── tests/ utils.test.js dom-smoke.test.js
└── docs/ 00 01 02 04 05 06 07 (lainnya menyusul per milestone)
```

## 5. Route Aplikasi

| Route | Halaman | Catatan |
|---|---|---|
| `#/` , `#/welcome` | Welcome/Onboarding | Halaman A |
| `#/create-account` | Buat akun (2 langkah) | Halaman B |
| `#/login` | Masuk + bantuan pemulihan | Halaman C |
| `#/app/chats` | Home / daftar chat | Halaman D |
| `#/app/friends` | Teman (3 tab) | Halaman E |
| `#/app/chat/:id` | Chat room / private / group | Halaman F, G, H |
| `#/app/profile` | Profil & settings | Halaman I |

Setiap route `#/app/*` dibungkus `_shell.js` (sidebar desktop + bottom nav mobile).

## 6. Status Implementasi

| # | Milestone | Status | Bukti |
|---|---|---|---|
| 1 | Design First (UI dummy, responsif) | **Tested (otomatis)** | `npm run check` 36/36 modul; `npm test` 28/28 lulus |
| 2 | Supabase Foundation (migrasi, RLS, Edge Functions) | **Tested (otomatis)** | 9 migrasi (001-009) terpasang di project `fkilgzkkzerpuapxfqka`; `node scripts/e2e-supabase.mjs` 45/45 lulus (termasuk `notify-push` -> FCM v1); lihat docs/07 |
| 3 | Account & Friends (auth nyata, QR asli) | **Tested (otomatis)** | `node scripts/e2e-services.mjs` 18/18 lulus (service layer live); lihat docs/02 |
| 4 | Chat & Private Conversion (realtime, offline) | **Tested (otomatis)** | `node scripts/e2e-chat.mjs` (bagian chat/konversi/outbox); lihat docs/04 & docs/05 |
| 5 | Group Chat (buat grup UI, role, kelola anggota) | **Tested (otomatis)** | smoke test buat grup; `node scripts/e2e-chat.mjs` 25/25 (bagian grup); lihat docs/06 |
| 6 | Capacitor & Finalisasi (scanner, push token, build APK) | **Tested (otomatis)** | scanner/push service lulus check+smoke; `docs/10` build APK (butuh mesin Android SDK) |

**Pengujian yang sudah dijalankan:**

- `npm run check` - semua 36 modul `src/` sukses diimpor di Node (tidak ada akses DOM di top-level, tidak ada import path salah).
- `npm test` - 28 test lulus:
  - 10 unit test util/router (waktu, kode akun, inisial, match route).
  - 18 smoke test DOM (happy-dom): render semua halaman, validasi form login/create-account (termasuk passphrase), search chat, state loading/error/empty, kirim pesan, konversi room->privat, penolakan konversi grup, buat grup multi-select, scanner/push fallback Node, pengaturan tema, 404.
- `node scripts/e2e-supabase.mjs` - **45/45 lulus** terhadap project Supabase nyata (Milestone 2 + push): register/login/recovery via Edge Functions, pencarian kode, friend request, room 2 anggota, pesan idempoten, isolasi RLS pihak luar, throttle 429, penutupan tabel kredensial, dan seksi `notify-push` (401 anon / 400 format / 403 bukan pengirim / sign JWT FCM + kirim HTTP v1 dgn token uji). Rincian: docs/07.
- `node scripts/e2e-services.mjs` - **18/18 lulus** (Milestone 3): service layer frontend dijalankan live (happy-dom + vendor UMD) - register, sesi, getProfile, update nama, recovery key lokal, login, cari kode, request/terima/hapus teman, guard tanpa sesi, state preview. Rincian: docs/02.
- `node scripts/e2e-chat.mjs` - **25/25 lulus** (Milestone 4+5): room 2 orang idempoten, kirim/baca pesan, `clientId` idempoten, unread + `markChatRead`, konversi dua tahap (propose/approve/self-approve ditolak), grup (create/rename/role/kick/akses non-anggota/leave), outbox offline (simulasi `navigator.onLine`), state preview. Rincian: docs/04, docs/05, docs/06.

**Belum diuji (jujur):**

- Tampilan visual di browser nyata & perangkat Android (butuh QA manual).
- Streaming Realtime dari klien diuji lewat service layer (subscribe channel + retry `subscribeResilient` + feed `subscribeMessageFeed`); **pengiriman event live di browser nyata belum diverifikasi manual**; E2E memakai REST/RPC (polling snapshot), bukan menunggu event WS.
- Status Online/Offline (Realtime Presence) sudah diuji via unit/e2e service, tetapi tampilan live antar dua perangkat belum QA manual.
- Upload avatar (perlu storage bucket + UI upload; bucket sudah ada di migrasi 006).
- Build APK & kamera/ML Kit di perangkat Android nyata (butuh mesin Android SDK + QA manual; lihat docs/10).
- Pengiriman push: server (`notify-push` -> FCM HTTP v1, secret `FCM_SERVICE_ACCOUNT_JSON`) **sudah diuji otomatis sampai respons FCM**; yang belum: token perangkat asli + tampilan notif background/foreground + tap notif di perangkat nyata (lihat docs/10).

## 7. Keputusan Desain Penting

1. **Kode akun publik bukan kredensial.** Login memakai kode akun + passphrase; kode hanya untuk identifikasi/QR/friend request.
2. **Autentikasi via Edge Function** (service-role) yang memverifikasi hash passphrase lalu memberi sesi Supabase Auth - bukan JWT custom buatan sendiri, bukan anonymous sign-in liar.
3. **Private chat** hanya dari room dengan tepat 2 anggota, butuh persetujuan keduanya, permanen, riwayat tidak dipindah (rincian docs/05).
4. **Satu halaman chat** melayani room/private/group; perbedaan lewat header, panel info, dan hak aksi - mengurangi duplikasi kode.
5. **State preview via query param**: `?state=loading|error|empty` pada route `#/app/*` untuk memeriksa state UI secara manual.

## 8. Cara Menjalankan & Menguji

```bash
npm install
npm run sync:env   # hasilkan src/config.js + vendor/supabase.js dari .env
npm run check      # 36/36 modul
npm test           # 28/28 test
npm run dev        # http://localhost:5173
```

Contoh pemeriksaan manual state:

- `http://localhost:5173/#/app/chats?state=loading`
- `http://localhost:5173/#/app/chats?state=error`
- `http://localhost:5173/#/app/chats?state=empty`
- `http://localhost:5173/#/app/chat/c_bima?state=error`
- `http://localhost:5173/#/app/profile?state=error`

## 9. Tahap Selanjutnya

**Milestone 6 selesai** (scanner progresif ML Kit + BarcodeDetector, push token native, docs/10 build APK). Perbaikan lanjutan selesai: push notification server penuh (`notify-push` FCM v1 + local notif foreground + tap navigation), feed realtime daftar chat + retry koneksi (`subscribeResilient`), "Teman sejak" bertanggal, dan status Online/Offline via Realtime Presence. Sisa pekerjaan non-kode: build APK di mesin Android SDK, QA push/realtime dua perangkat nyata, upload avatar.
