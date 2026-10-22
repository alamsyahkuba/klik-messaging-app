# 06 - Group Chat (Milestone 5)

Dokumen ini menjelaskan fitur **grup** KLIK: pembuatan lewat UI, role admin/owner, kelola anggota, keluar grup, dan aturan server (RPC SECURITY DEFINER).

| Item | Nilai |
|---|---|
| UI buat grup | `home.js` - chooser "Percakapan baru" -> "Buat grup baru" |
| Service | `createGroup`, `renameGroup`, `leaveGroup`, `addGroupMember`, `removeGroupMember`, `setMemberRole`, `listMembers`, `myRole`, `isGroupAdmin` |
| RPC (migrasi 003 + 008) | `create_group_room`, `rename_group`, `add_room_members`, `remove_room_member`, `set_room_member_role`, `leave_room` |
| Uji | smoke test buat grup; `e2e-chat.mjs` bagian grup (create/rename/role/leave) |

## 1. Membuat grup (UI)

Alur di halaman Home:

1. Klik tombol **+** ("Percakapan baru") -> modal chooser:
   - **Chat 1:1 dengan teman** (alur lama, `startChatWith`)
   - **Buat grup baru** (`createGroup`)
2. Form grup:
   - Input **nama grup** (3-60 karakter, divalidasi klien & server).
   - **Multi-select teman**: daftar teman dengan toggle (border biru + centang); counter "N teman dipilih".
   - Tombol **Buat Grup** aktif hanya jika nama valid **dan** minimal 1 teman dipilih.
3. Sukses -> toast + navigasi `#/app/chat/<id>`; grup langsung terbuka.

Catatan server (`create_group_room`):

- Semua anggota yang dipilih **harus sudah berteman** dengan pembuat (dicek per-id).
- Pembuat otomatis `owner`; anggota lain `member`.
- Maksimal 99 anggota; nama dibersihkan (`btrim`).

## 2. Role

| Role | Izin |
|---|---|
| `owner` | Semua izin admin + menurunkan admin ke member + tidak bisa dikeluarkan |
| `admin` | Tambah/keluarkan anggota (bukan owner), promosi member -> admin, rename grup |
| `member` | Kirim pesan, membaca, keluar sendiri |

Di UI (`listMembers` live), role `owner` **ditampilkan sebagai "Admin"** (normalisasi) agar konsisten dengan data dummy yang hanya punya `admin|member`. Perbedaan owner vs admin tetap berlaku di server (hanya owner yang bisa menurunkan admin).

`myRole(chatId)` / `isGroupAdmin(chatId)` membaca cache `chatMeta` yang diisi saat `getChat`/`listMembers`. Sebelum cache terisi (mis. drawer baru dibuka), `isGroupAdmin` mengembalikan `false` (default aman).

## 3. Kelola anggota (drawer info grup)

Panel info (`fillGroup` di `chat.js`) menampilkan:

- Role kamu, jumlah anggota, dibuat oleh.
- Daftar anggota + badge Admin.
- Aksi (hanya admin, bukan untuk diri sendiri):
  - **Ubah role** (admin <-> member; di server: hanya owner yang menurunkan admin).
  - **Keluarkan dari grup** (confirm modal; server menolak untuk owner).
- **Tambah anggota**: daftar teman yang belum bergabung.
- **Ubah nama grup** (admin).
- **Zona berbahaya**: "Keluar dari grup" (confirm; teks berbeda untuk admin).

## 4. Keluar dari grup (`leave_room`)

| Situasi | Efek server |
|---|---|
| Member keluar | Baris `chat_room_members` dihapus |
| Admin keluar | Sama; sisa admin/owner tetap menjalankan grup |
| Owner keluar | Jika ada admin tersisa -> admin itu lanjut; jika tidak -> anggota **paling lama** bergabung dipromosikan jadi owner |
| Anggota terakhir keluar | Room dihapus (trigger `enforce_member_rules`) |

UI: setelah sukses -> toast, tutup drawer, navigasi ke `#/app/chats`.

## 5. Batasan server (membuktikan RLS + validasi)

Semua operasi tulis lewat RPC SECURITY DEFINER; client tanpa policy insert/update/delete langsung ditolak. Contoh pesan error:

- Non-admin rename -> `Hanya admin yang dapat mengubah nama grup` (42501).
- Non-admin tambah/keluarkan anggota -> `Hanya admin yang dapat ...`.
- Keluarkan owner -> `Owner tidak bisa dikeluarkan`.
- Turunkan admin oleh admin (bukan owner) -> `Hanya owner yang dapat menurunkan admin`.
- Anggota bukan teman saat tambah ke grup -> `Hanya teman yang bisa ditambahkan ke grup`.
- Grup kosong (anggota terakhir keluar) -> room terhapus; `getChat` berikutnya -> `Room tidak ditemukan`.

## 6. Riwayat pesan di grup

- Anggota yang dikeluarkan **tetap** punya salinan riwayat lama di perangkatnya (snapshot terakhir yang pernah mereka muat); mereka **tidak menerima pesan baru** setelah keluar (RLS `is_room_member`).
- Tidak ada "hapus riwayat anggota" di server - pesan yang sudah terkirim tersimpan di `messages` selama room masih ada.
- Anggota baru yang ditambahkan **tidak melihat riwayat lama** di UI? Sebenarnya `listMessages` mengembalikan semua pesan room - anggota baru **bisa** membaca riwayat penuh room (keputusan desain: grup = ruang bersama; tidak ada enkripsi E2E).

## 7. Pengujian

- **Smoke test** (`npm test`): chooser -> form buat grup -> multi-select 2 teman -> submit -> navigasi ke chat grup (mode demo).
- **E2E live** (`node scripts/e2e-chat.mjs`): createGroup A[B], listMembers + isGroupAdmin, rename, setMemberRole B admin lalu member, B (non-admin) rename ditolak, B leave -> sisa A, A leave -> room terhapus.

## 8. Yang belum / batas jujur

- Tidak ada notifikasi push saat ditambahkan ke grup (Milestone 6).
- Tidak ada pencarian anggota di grup besar (daftar dimuat penuh).
- Transfer ownership manual (pilih owner baru) belum ada - hanya otomatis saat owner keluar.
- UI "anggota baru tidak baca riwayat lama" tidak diterapkan (lihat §6 - desain memilih transparan).
