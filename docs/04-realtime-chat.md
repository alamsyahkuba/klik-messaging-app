# 04 - Chat, Realtime & Offline (Milestone 4)

Dokumen ini menjelaskan bagaimana `chats-service` bekerja di **mode live** (Supabase) dan **mode demo** (dummy Milestone 1), termasuk Realtime dan antrean pesan offline.

| Item | Nilai |
|---|---|
| Service | `src/services/chats-service.js` |
| Antrean offline | `src/utils/offline-queue.js` (IndexedDB `klik-outbox`) |
| Tabel | `chat_rooms`, `chat_room_members`, `messages` |
| RPC baru (migrasi 008) | `list_my_chats()`, `rename_group()` |
| Uji | `node scripts/e2e-chat.mjs` -> **25/25 lulus** (chat+grup; Milestone 4-5) |

## 1. Mode live vs demo

Pola yang sama dengan `auth-service`/`friends-service` (docs/02):

- `isLive()` = `BACKEND_ENABLED && window.supabase?.createClient` (lihat `src/services/supabase.js`).
- Di Node / uji otomatis tanpa vendor UMD, `isLive()` false -> semua fungsi memakai jalur demo dummy (smoke test tetap lulus tanpa jaringan).
- State preview `?state=loading|error|empty` tetap memakai `respond()` dari `_fake.js` di kedua mode.

## 2. Kontrak fungsi (dipertahankan dari Milestone 1)

| Fungsi | Live (Supabase) | Demo (dummy) |
|---|---|---|
| `listChats()` | RPC `list_my_chats` + join profil peer | map dari `chats[]` dummy |
| `getChat(id)` | room + members + roles + conversion + unread | map dari `chats[]` + `groupRoles` |
| `listMessages(id, {before})` | `messages` order `created_at` (cursor `before` untuk pagination) | `messagesByChat[id]` |
| `sendMessage(id, text, {replyTo, clientId})` | insert dengan id klien; offline -> outbox | push ke dummy |
| `markChatRead(id)` | RPC `mark_room_read` (fire-and-forget) | set `unread = 0` |
| `listMembers(id)` | `chat_room_members` + profiles | map dari `memberIds` |
| `myRole` / `isGroupAdmin` | cache `chatMeta` (diisi `getChat`/`listMembers`) | `groupRoles` dummy |
| `proposeConversion` / `approveConversion` / `cancelConversion` | RPC dua tahap (docs/05) | simulasi auto-approve |
| `convertToPrivate` | alias `proposeCompatibility` -> `proposeConversion` | simulasi auto-approve |
| `startChatWith(friendId)` | RPC `create_room_with` (idempoten) | cari/buat chat dummy |
| `createGroup` / `renameGroup` / `leaveGroup` | RPC `create_group_room` / `rename_group` / `leave_room` | mutasi dummy |
| `addGroupMember` / `removeGroupMember` / `setMemberRole` | RPC `add_room_members` / `remove_room_member` / `set_room_member_role` | mutasi dummy |
| `subscribeRoom(chatId, {onMessage, onRoomChange})` | channel Realtime (lihat §5) | no-op |
| `flushOutbox()` | kirim ulang pesan tertunda | no-op |

Halaman `chat.js`/`home.js` tidak berubah bentuk data; mereka memanggil fungsi yang sama.

## 3. Daftar percakapan (`list_my_chats`)

RPC `list_my_chats` (SECURITY DEFINER, migrasi 008) mengembalikan **satu baris per room milik caller**:

- judul/anggota (`member_ids`), role saya (`my_role`)
- pesan terakhir (lateral join limit 1)
- `unread_count` = pesan di room dengan `created_at > last_read_at` **dan** `sender_id <> saya`

Client lalu mengambil `profiles` untuk semua peer id (satu query `.in`) -> judul privat = nama peer, preview = `Kamu: ...` / `Nama: ...`.

## 4. Pesan & idempotensi

- `messages.id` = **UUID yang dihasilkan klien** (`crypto.randomUUID()`). Kirim ulang dengan `clientId` yang sama = conflict 23505 -> service mengembalikan baris yang sudah ada (tidak ada pesan ganda).
- `sendMessage(chatId, text, { replyTo, clientId })`:
  - online: insert -> status `'sent'`
  - offline (`navigator.onLine === false`): masuk outbox -> status `'queued'`
- Pagination: `listMessages(id, { before })` memakai cursor `(created_at)`; default 50 pesan terakhir.

## 5. Realtime

`subscribeRoom(chatId, { onMessage, onRoomChange })` membuat channel `klik-room-<id>` dengan dua listener `postgres_changes`:

| Event | Tabel | Filter | Callback |
|---|---|---|---|
| INSERT | `messages` | `room_id=eq.<id>` | `onMessage(mapMessage(row))` |
| UPDATE | `chat_rooms` | `id=eq.<id>` | `onRoomChange(row)` (mis. konversi selesai) |

RLS menjamin caller **hanya menerima event room yang ia anggota** (publikasi `supabase_realtime` = `messages` + `chat_rooms`, migrasi 006).

### 5a. Ketahanan koneksi (`subscribeResilient`)

Keduanya dibungkus helper `subscribeResilient(createChannel)`:

- Callback `CHANNEL_STATUS`: `CHANNEL_ERROR`/`TIMED_OUT` -> tunda lalu **buat channel baru** dengan backoff `[1, 2, 5, 10, 30]` detik (kirim kejadian terakhir via onMessage/onRoomChange bila sudah pernah join).
- Event `online` dan `visibilitychange -> visible` -> re-join channel aktif seketika (pulih dari sleep/NFC/offline).
- Fungsi unsubscribe mereset backoff, melepas listener `online`/`visibilitychange`, dan menghapus channel.

### 5b. Feed daftar chat (`subscribeMessageFeed`)

`home.js` memanggil `subscribeMessageFeed(onMessage)` -> channel `klik-feed-<seq>` dengan INSERT `messages` **tanpa filter** (RLS membatasi ke room anggota caller). Callback: `scheduleRefresh()` (debounce 600 ms) -> `load({silent:true})` -> daftar chat + subtitle & preview terakhir selalu up-to-date tanpa membuka chat. Ini menutup masalah "pesan masuk di daftar hanya ter-update saat app dibuka/di-resume".

Di halaman `chat.js`:

- `onMessage`: dedupe by id -> push ke daftar -> render -> `markChatRead`
- `onRoomChange`: refresh `getChat`; bila tipe berubah menjadi `private` -> toast "Percakapan resmi menjadi Chat Privat."
- `cleanup` memanggil fungsi unsubscribe (hapus channel) + `clearTimeout` debounce feed.

## 6. Antrean offline (IndexedDB)

`src/utils/offline-queue.js`:

- Browser: object store `messages` di database IndexedDB `klik-outbox` (keyPath `id`).
- Tanpa IndexedDB (Node/uji): fallback **in-memory** per sesi - queue tetap berfungsi untuk uji tanpa merusak.

Alur:

1. `sendMessage` saat offline -> `enqueue({ id, roomId, text, replyTo, at })` -> status `'queued'`.
2. Event `online` di `chat.js` -> `flushOutbox()` -> kirim ulang per item (idempoten, `allowQueue: false` agar tidak loop) -> `remove` setelah sukses.
3. Gagal karena jaringan masih mati: berhenti, sisanya tetap antre. Error lain (mis. room terhapus): item dibuang agar tidak macet.

**Batas jujur:** pengujian otomatis simulasi offline memakai `Object.defineProperty(navigator, 'onLine')` di happy-dom (lihat `e2e-chat.mjs`); perilaku di browser nyata belum diuji manual.

## 7. Unread & tanda dibaca

- `chat_room_members.last_read_at` diperbarui oleh RPC `mark_room_read` (`greatest(last_read_at, now())`).
- `markChatRead` di service **fire-and-forget** (halaman memanggil sinkron tanpa await).
- `list_my_chats` menghitung unread per room; halaman home menampilkan badge.

## 8. Grup (ringkas; rincian docs/06)

Operasi grup di live semuanya lewat RPC SECURITY DEFINER (validasi server):

- `create_group_room(group_name, member_ids)` - semua anggota harus teman.
- `rename_group(p_room, p_name)` - hanya admin/owner; nama 3-60 karakter (migrasi 008).
- `add_room_members` / `remove_room_member` / `set_room_member_role` - admin; owner tidak bisa dikeluarkan; hanya owner yang menurunkan admin.
- `leave_room` - grup: owner yang keluar -> admin tersisa / promosi anggota tertua; non-grup: room dihapus.

Role `owner` di UI ditampilkan sebagai "Admin" (normalisasi di `listMembers` live).

## 9. Cara menguji ulang

```bash
npm run sync:env    # pastikan vendor/ + config.js ada
npm run check       # 36 modul
npm test            # 28 test (mode demo)
node scripts/e2e-chat.mjs       # 25 asersi live (chat + grup M4-M5)
node scripts/e2e-services.mjs   # 18 asersi live (auth/friends M3)
node scripts/e2e-supabase.mjs   # 45 asersi live (backend mentah M2)
```

E2E chat mencakup: room 2 orang idempoten, kirim/baca pesan, `clientId` idempoten, unread + `markChatRead`, konversi dua tahap (propose/approve/self-approve ditolak), grup (create/rename/role/leave), outbox offline, state preview.
