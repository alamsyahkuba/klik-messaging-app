# 09 - Notification System (WhatsApp-like)

Dokumen ini menjelaskan implementasi sistem notifikasi pesan masuk dengan perilaku yang menyerupai WhatsApp di aplikasi KLIK.

## Arsitekturnotifikasi

| Kondisi | Sumber Notifikasi | Alur |
|---|---|---|
| **Aplikasi terbuka (foreground)** | **Supabase Realtime** → `LocalNotifications` (system notif lokal) | Realtime mendeteksi pesan baru, filter berdasarkan membership, lalu jadwalkan notifikasi lokal jika chat tidak sedang aktif |
| **Aplikasi background** | **FCM HTTP v1** via Edge Function `notify-push` | Edge Function mengirim FCM ke `device_tokens` penerima; Android menampilkan system notifikasi secara otomatis |
| **Aplikasi ditutup** | **FCM** (jalur utama) | FCM delivery saat aplikasi tidak running; bergantung pada kemampuan Android & jaringan |
| **Chat UI update** | **Supabase Realtime** langsung | Realtime update percakapan tanpa perlu notifikasi sistem |

## 1. Deduplikasi Realtime + FCM

**Masalah**: Kedua channel (Realtime + FCM) bisa mendeliver event pesan yang sama, menghasilkan dua notifikasi.

**Solusi**: Central `shownMessageIds` Set yang berbagi antara `push-service.js` dan `foreground-notifications.js`.

**Mekanisme**:
- Set diset per sesi pengguna (diberi `clearAllShown()` saat logout)
- Sebelum jadwalkan local notification: cek `isAlreadyShown(messageId)`
- Jika sudah ditampilkan: skip (bukan hapus, cegah duplikat)
- Jika baru: `markShown(messageId)` setelah schedule

**File yang menangani**:
- `src/services/push-service.js`: `bindPushNotificationListener()` cek `isAlreadyShown()` sebelum schedule
- `src/services/foreground-notifications.js`: `subscribeForegroundNotifications()` cek `isAlreadyShown()` sebelum schedule

**Stable Notification ID**: Digunakan hash SHA-256 dari `message.id` (UUID klien) untuk menghasilkan integer 1-2147483647 yang stabil.

## 2. Foreground Notification Handling

### A. Permit & Permission Flow
1. Saat subscribe Realtime: cek `LocalNotifications.checkPermissions()`
2. Jika tidak granted: minta `LocalNotifications.requestPermissions()`
3. Jika user menolak: tampilkan pesan in-app untuk mengizinkan di setting
4. `getNotificationPrefs().messagePreview` mengontrol body text visibility

### B. Chat Foreground Detection
- Jika `location.hash === #/app/chat/${chatId}`: tampilkan pesan langsung di chat, **skip** notifikasi sistem
- Jika KLIK dibuka tapi chat berbeda: tampilkan notifikasi lokal dengan nama pengirim & preview isi
- Gunakan `clearNotificationsForRoom(chatId)` saat halaman chat dibuka (hapus notif related)

### C. Sender Name & Preview
- Ambil `display_name` dari tabel `profiles` berdasarkan `sender_id`
- Jika `messagePreview` false: body = "Pesan baru"
- Jika `messagePreview` true: body = `message.body` (dipotong 120 karakter di Edge Function)

### D. Stable Notification ID
- Hash `message.id` ke integer: `(Number.parseInt(crypto.createHash('sha256').update(message.id).digest('hex'), 16) % 2147483647) + 1`
- Ditingkatkan dari `Math.floor(Date.now() % 2147483647)` yang tidak stabil

## 3. Background & Closed Notification Handling (FCM)

### A. Edge Function `notify-push`
- Menggunakan FCM HTTP v1 dengan `authorization: Bearer <access_token>`
- Hanya pengirim pesan yang boleh memicu (`msg.sender_id !== uid`)
- Filter recipient melalui `chat_room_members` (hanya anggota selain pengirim)
- Respek `device_tokens.settings.messagePreview` (false → body "Pesan baru")
- `android: priority: "high"` untuk kirim segera
- Bersihkan token yang tidak valid dari `device_tokens`

### B. FCM Payload Structure
```json
{
  "message": {
    "token": "<FCM token>",
    "notification": {
      "title": "KLIK",
      "body": "Pesan baru" /* atau preview isi */
    },
    "data": { "chatId": "<room uuid>" },
    "android": { "priority": "high" }
  }
}
```

### C. Prevent Self-Notification
- Edge Function: `if (msg.sender_id !== uid) return errorJson(..., "FORBIDDEN")`
- Client Realtime: `if (message.sender_id === userId) return;` (ignore own message)

## 4. Read Receipt & Notification Cleanup

### A. Saat Pengguna Membuka Percakapan
1. Navigasi ke `#/app/chat/${chatId}` → trigger `hashchange` event
2. `clearNotificationsForRoom(chatId)` membersihkan cache ID shown
3. `mark_room_read` RPC memperbarui `chat_room_members.last_read_at`
4. `list_my_chats` menghitung `unread_count = 0` untuk ruangan tersebut

### B. Saat Pesan Dibaca
1. `markChatRead(chatId)` dipanggil (fire-and-forget via RPC)
2. Setelah RPC sukses: `clearNotificationsForRoom(chatId)`
3. Unread count di halaman home diperbarui otomatis melalui `subscribeMessageFeed`

### C. Cross-Device Sync
- Status baca disinkronisasi melalui Realtime channel `chat_room_members`
- Perubahan di perangkat lain akan terkirim ke perangkat aktif
- Hanya diproses jika RLS mengizinkan pengguna yang bersangkutan

## 5. Deep Link & Navigation on Tap

### A. Saat Notifikasi Ditekan
1. `openChatFromNotif(data)` di `push-service.js` menangani `pushNotificationActionPerformed`
2. `location.hash = #/app/chat/${chatId}` - buka obrolan yang benar
3. `mark_room_read` RPC dipanggil (fire-and-forget) untuk tandai kamar baca
4. Halaman chat merender dengan unread count = 0

### B. Chat Page Auto-Mark
- Saat chat dimuat, pesan yang sudah terbaca ( sesuai `last_read_at`) tidak ditandai lagi sebagai unread
- Pesan baru muncul di atas daftar
- Scroll otomatis ke pesan terbaru

## 6. Token Management & Logout Cleanup

### A. Register Token Flow
1. `registerPushToken()` → `Push.requestPermissions()` → `Push.register()` → `registration` event
2. Token disimpan ke `device_tokens` table beserta `settings` (messagePreview, sound)
3. `registeredUid` & `registeredToken` ditrack di dalam module

### B. Logout Cleanup
1. `watchAuth()` mendengar `SIGNED_OUT`
2. `unregisterPushToken()` → `clearAllShown()` → hapus token dari DB
3. `unsubscribeForegroundNotifications()` → hapus channel Realtime
4. `clearAllShownLocally()` → koshi cache ID notifikasi

### C. Token Invalid Handling
- Edge Function sudah membersihkan token `NOT_FOUND`/`INVALID_ARGUMENT`/`UNREGISTERED`
- Jika token kedaluwarsa: user harus login ulang untuk mendaftarkan token baru

## 7. Environment Variables

| Variable | Deskripsi | Contoh |
|---|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | Isi file Service Account Firebase (Project Settings → Service Accounts → Generate private key) | `{"type": "service_account", "project_id": "..., ...}` |
| `SUPABASE_URL` | Supabase project URL | `https://xyz.supabase.co` |
| `SUPABASE_ANON_KEY` | Anon key (aman untuk frontend, dibatasi RLS) | `sb_publishable_...` |
| `BACKEND_ENABLED` | `true` jika konfigurasi di atas lengkap | `true`/`false` |

**Penting**: Service Account private key **bisa** disimpan di secret Supabase (`npx supabase secrets set`) dan diakses di Edge Function. **Jangan** pernah commits file JSON kunci ke repo.

## 8. Manual Testing Steps (Android)

### Setup
1. `npx cap sync android`
2. `./gradlew assembleDebug`
3. `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
4. Setup `google-services.json` di `android/app/`
5. Set secret `FCM_SERVICE_ACCOUNT_JSON` via Supabase

### Test Cases

| # | Scenario | Expected |
|---|---|---|
| 1 | Pesan masuk saat opening chat yang sama | Pesan tampil di chat, **tanpa** system notifikasi |
| 2 | Pesan masuk saat opening chat yang berbeda | System notifikasi lokal tampil dengan nama pengirim |
| 3 | Pesan masuk saat di halaman lain | System notifikasi lokal tampil |
| 4 | Pesan masuk saat minimize app | FCM system notifikasi tampil (Android) |
| 5 | Pesan masuk saat app ditutup | FCM works sesuai kemampuan Android |
| 6 | Tap notifikasi → buka chat | Chat yang benar terbuka di app |
| 7 | Pesan dibaca | Notifikasi terkait dihapus / unread count = 0 |
| 8 | Percakapan A dibaca | Notif percakapan B tetap ada jika punya pesan belum dibaca |
| 9 | Baca pesan di perangkat lain | Notif terkait disinkron dan dibersihkan di perangkat aktif |
| 10 | Event Realtime duplikat | Hanya satu notifikasi yang tampil |
| 11 | Pengirim sendiri mengirim pesan | **Tidak ada** notifikasi untuk pesan sendiri |
| 12 | Logout & login akun lain | Listener, token, notif tidak tercampur antar akun |
| 11 | Koneksi putus lalu pulih | Pesan & status baca tersinkronisasi |
| 13 | RLS mencegah akses tidak sah | Hanya anggota room yang bisa baca pesan/status |
| 14 | FCM kembalikan token tidak valid | Token dibersihkan dari device_tokens otomatis |

### Verifikasi Logcat
- `Foreground local notification berhasil dijadwalkan` (Realtime)
- `FCM token received` (saat register token)
- Tidak ada log duplikat "Foreground local notification berhasil dijadwalkan" untuk pesan yang sama

## 9. Batasan & Catatan Penting

### A. Android Doze & Konektivitas
- Notifikasi tidak selalu instan; bergantung pada Battery Optimizations
- FCM butuh Google Services; di device tanpa Google Play, FCM bisa gagal
- Jika baterai di-save, notifikasi tertunda hingga device Aktif

### B. Browser vs Native
- Di browser (WebView Capacitor): `LocalNotifications` menggunakan Notification API standar
- Di native Android: `LocalNotifications` menggunakan plugin asli; FCM works dengan benar
- `bindPushNotificationListener()` dan `bindForegroundNotifications` adalah no-op di environment web tanpa Capacitor

### C. Privacy & Data Protection
- Isi pesan tidak dibocorkan ke pengirim atau pihak ketiga
- `messagePreview` preference dihormati per perangkat
- Tidak ada data rahasia (token, key) di frontend code atau dokumentasi
- RLS tetap ketat: hanya anggota chat yang bisa baca pesan & status baca

### D. Deduplikasi Batasan
- Set `shownMessageIds` bersih saat logout (tidak akumulasi permanent)
- Maksimal 100 ID yang disimpan per sesi (melewati ID lama jika melebihi)
- ID berdasarkan hash `message.id`, bukan waktu event

### E. FCM Limitations
- FCM butuh akses ke Google servers; tidak bekerja jika Google Services tidak tersedia
- TTL (Time to Live) diset 24 jam maksimum di Edge Function
- Prioritas `high` asegurasi delivery segera tapi tetap tergantung jaringan/device

## 10. File yang Dimodifikasi

1. `src/services/push-service.js` - Deduplikasi, permission handling, logout cleanup, openChatFromNotif enhancements
2. `src/services/foreground-notifications.js` - Stable IDs, deduplication, permission flow, cleanup functions
3. `src/services/chats-service.js` - `markChatRead` menambah `clearNotificationsForRoom` call
4. `src/main.js` - Import perbaikan, hashchange listener untuk cleanup pada navigasi chat
5. `docs/notifications.md` - Dokumentasi lengkap (file ini)

## 11. Kesimpulan

KLIK sekarang memiliki alur notifikasi yang konsisten:

1. **Foreground**: Pesan langsung melalui Realtime, skip system notif jika chat aktif
2. **Background/Closed**: FCM menampilkan system notifikasi Android
3. **Deduplikasi**: Tidak ada notifikasi ganda antara Realtime + FCM
4. **Read Receipt**: Ketika dibaca, notifikasi terkait dibersihkan
5. **Navigasi**: Tap notifikasi → chat yang benar, otomatis tandai baca
6. **Keamanan**: RLS melindungi, token dikelola safely, self-notification dicegah

Implementasi ini minimal mengubah arsitektur yang sudah ada (Realtime + FCM terpisah) dan menambah lapisan deduplikasi, ID stabil, serta cleanup yang tepat waktu.