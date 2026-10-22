# KLIK - Dokumentasi Proyek

Aplikasi chat modern tanpa email dan nomor telepon. Dibangun dengan **HTML5 + CSS3 + Vanilla JavaScript ES Modules**, dibungkus **Capacitor** untuk Android/iOS, dengan backend **Supabase** (PostgreSQL, Auth/Edge Functions, Realtime, Storage).

## Mulai Cepat (Milestone 1 - UI)

```bash
cd /home/alam/klik
npm install          # dependency (sekali saja)
npm run dev          # server statis di http://localhost:5173
```

Buka `http://localhost:5173` (atau port lain, terserah `python3 -m http.server <port>`).

> Milestone 1-6 selesai - lihat
> [docs/00-project-overview.md](docs/00-project-overview.md) untuk status & peta milestone.
> Chat memakai Supabase (rooms + messages + Realtime + outbox offline);
> mode demo dummy tetap dipakai uji otomatis Node.
> Build Android/iOS: [docs/10-capacitor-android.md](docs/10-capacitor-android.md).

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server statis (python) |
| `npm start` | Server statis (`npx serve`) |
| `npm run check` | Cek sintaks + graph modul ES semua file `src/` (tanpa browser) |
| `npm test` | Unit test util/router + smoke test render (happy-dom) |
| `npm run build:dist` | Salin `index.html` + `src/` + `vendor/` ke `dist/` (webDir Capacitor) |
| `npm run sync:env` | Hasilkan `src/config.js` + `vendor/supabase.js` dari `.env` |
| `node scripts/apply-migrations.mjs` | Terapkan migrasi SQL ke project Supabase remote |
| `node scripts/e2e-supabase.mjs` | Uji E2E backend mentah (41 asersi) ke project Supabase nyata |
| `node scripts/e2e-services.mjs` | Uji E2E service layer live (18 asersi) via happy-dom |
| `node scripts/e2e-chat.mjs` | Uji E2E chat live (25 asersi): pesan, unread, konversi, grup, outbox |

## Struktur

```
klik/
├── index.html                 # shell aplikasi
├── capacitor.config.ts        # konfigurasi Capacitor (Milestone 6)
├── src/
│   ├── main.js                # bootstrap + registrasi route
│   ├── router/router.js       # hash router
│   ├── styles/                # tokens, reset, global, components, responsive
│   ├── components/            # UI reusable (avatar, modal, toast, bubble, dll)
│   ├── pages/                 # satu file per halaman
│   ├── services/              # supabase + auth/friends/profile/chats (live) & dummy
│   ├── data/dummy.js          # data dummy (mode demo & Milestone 1)
│   └── utils/                 # dom, waktu, id, preferensi, viewport, offline-queue
├── vendor/                    # UMD supabase-js (hasil npm run sync:env)
├── scripts/                   # check-syntax, build-dist, sync-env, apply-migrations, e2e-*
├── tests/                     # unit + DOM smoke test
├── supabase/                  # 8 migrasi SQL + Edge Functions auth-register/login/recover
└── docs/                      # dokumentasi fitur (file terpisah per fitur)
```

## Dokumentasi

| File | Isi |
|---|---|
| [docs/00-project-overview.md](docs/00-project-overview.md) | Tujuan, arsitektur, stack, status implementasi |
| [docs/01-design-system.md](docs/01-design-system.md) | Design system Neobrutalism: token, komponen, responsivitas |
| [docs/02-account-friends.md](docs/02-account-friends.md) | Mode live/demo, auth-service, friends-service, QR (Milestone 3) |
| [docs/04-realtime-chat.md](docs/04-realtime-chat.md) | chats-service live, Realtime, outbox offline (Milestone 4) |
| [docs/05-private-chat-conversion.md](docs/05-private-chat-conversion.md) | Konversi room -> chat privat dua tahap (Milestone 4) |
| [docs/06-group-chat.md](docs/06-group-chat.md) | Grup: buat, role admin/owner, kelola anggota, leave (Milestone 5) |
| [docs/07-supabase-setup.md](docs/07-supabase-setup.md) | Skema DB, RLS, RPC, Edge Functions, cara uji E2E (Milestone 2) |
| [docs/10-capacitor-android.md](docs/10-capacitor-android.md) | Build APK, plugin ML Kit & push, konfigurasi FCM (Milestone 6) |

## Keamanan (ringkas)

- Tidak ada service role key di frontend. Hanya `SUPABASE_URL` + anon key yang boleh masuk `.env` web.
- Kode akun publik **bukan** password/token login (lihat rencana di docs/00).
- `.env` tidak di-commit (lihat `.gitignore`); salin dari `.env.example`.
