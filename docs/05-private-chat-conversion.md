# 05 - Konversi Room ke Chat Privat (Milestone 4)

Dokumen ini menjelaskan aturan dan implementasi **konversi room biasa -> chat privat**, yang diuji otomatis di `scripts/e2e-chat.mjs`.

## 1. Aturan produk

1. **Hanya room dengan tepat 2 anggota.** Grup tidak pernah bisa dikonversi.
2. **Kedua anggota harus menyetujui** (dua tahap): salah satu mengajukan, anggota LAIN menyetujui.
3. **Persahabatan wajib:** kedua anggota harus berteman saat mengajukan (dicek server).
4. **Riwayat pesan tidak dipindah/dihapus** - room dan isinya tetap, hanya `type` berubah.
5. **Konversi bersifat permanen.** Tidak ada "kembali menjadi room".
6. **Chat privat tidak menerima anggota baru** (trigger `enforce_member_rules`).

## 2. Implementasi server (RPC dua tahap)

Kolom di `chat_rooms` (migrasi 003):

| Kolom | Nilai |
|---|---|
| `type` | `room` \| `private` \| `group` |
| `conversion_state` | `none` \| `proposed` |
| `conversion_proposed_by` | uuid pengusul |
| `conversion_proposed_at` | timestamptz |
| `converted_at` | timestamptz saat selesai |

### Tahap 1: `propose_conversion(p_room)`

Dipanggil salah satu anggota. Validasi server:

- room ada; caller anggota
- `type = 'room'` (bukan `private`/`group`)
- tepat 2 anggota
- kedua anggota berteman

Efek: `conversion_state = 'proposed'`, `conversion_proposed_by = caller`.

### Tahap 2: `approve_conversion(p_room)`

Dipanggil anggota LAIN. Validasi tambahan:

- `conversion_state = 'proposed'`
- `conversion_proposed_by <> caller` (pengusul **tidak** bisa menyetujui usulannya sendiri)
- idempoten: bila sudah `private`, fungsi return sukses tanpa error

Efek atomik:

```
type = 'private'
conversion_state = 'none'
conversion_proposed_by / _at = null
converted_at = now()
```

### Pembatalan: `cancel_conversion(p_room)`

Mengembalikan `conversion_state = 'none'`. Bisa dipanggil pengusul (UI: tombol "Batalkan usulan").

## 3. Implementasi client (`chats-service` + `chat.js`)

### Service

| Fungsi | RPC | Catatan |
|---|---|---|
| `proposeConversion(chatId)` | `propose_conversion` | live; demo: auto-approve (simulasi M1) |
| `approveConversion(chatId)` | `approve_conversion` | live; demo: set `type = 'private'` |
| `cancelConversion(chatId)` | `cancel_conversion` | live; demo: no-op |
| `convertToPrivate(chatId)` | alias -> `proposeConversion` | kompatibilitas mundur |

`getChat` live menyertakan:

```js
conversion: { state, proposedBy, proposedAt }
```

### UI (drawer info, `fillDirect`)

Untuk `chat.type === 'room'`, panel "Konversi ke Chat Privat" punya 3 status:

| Status | Tampilan | Aksi |
|---|---|---|
| `none` | Aturan + tombol "Ajukan konversi" | `proposeConversion` |
| `proposed` oleh saya | "Menunggu persetujuan anggota lain" (disabled) + tombol "Batalkan usulan" | `cancelConversion` |
| `proposed` oleh anggota lain | Penjelasan + tombol "Setujui konversi" | `approveConversion` |

Setelah aksi sukses, halaman refresh `getChat` dan render ulang drawer.

### Realtime

Listener UPDATE `chat_rooms` di `subscribeRoom` (docs/04) memicu refresh; bila tipe berubah menjadi `private`, kedua sisi melihat toast "Percakapan resmi menjadi Chat Privat." tanpa reload manual.

## 4. Uji otomatis (e2e-chat)

Alur yang dibuktikan terhadap project nyata:

1. A propose -> room masih `type = 'room'`, `conversion.state = 'proposed'`, `proposedBy = A` (dicek dari sesi B).
2. A mencoba approve usulannya sendiri -> **ditolak** (`ServiceError`).
3. B approve -> kedua anggota melihat `type = 'private'`; riwayat pesan lama tetap ada.
4. Propose lagi pada private -> **ditolak**.

## 5. Keputusan & alternatif

- **Dua tahap vs satu klik:** satu klik (seperti dummy Milestone 1) melanggar persetujuan kedua anggota; desain produk memilih dua tahap.
- **Tidak memindah riwayat:** memindah berarti duplikasi data + masalah izin lama; room private baru dengan riwayat kosong justru menghapus konteks. Room lama cukup berganti tipe.
- **Bukan enkripsi end-to-end:** pesan tetap di Postgres; "privat" berarti **hanya dua anggota yang diizinkan RLS**, bukan kriptografi E2E. Ini ditegaskan di UI drawer.
