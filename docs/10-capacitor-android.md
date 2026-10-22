# 10 - Build Android (Capacitor)

> Milestone 6. Dokumen operasional: cara membangun APK KLIK di mesin Windows/Linux yang punya Android SDK.
> **Mesin pengembangan saat ini (tanpa Android SDK) tidak bisa mem-produce APK** - langkah di bawah dijalankan di mesin Anda.

## Prasyarat

| Kebutuhan | Catatan |
|---|---|
| Node.js >= 20 | sama dengan pengembangan |
| Android Studio | atau Android SDK command-line tools + JDK 17 |
| `JAVA_HOME` | menunjuk JDK 17 bawaan Android Studio |
| Akun Supabase | project sudah linked; Edge Functions sudah deployed |

## Langkah build APK

```bash
# 1. Install dependensi (termasuk plugin Capacitor)
npm install

# 2. Pastikan src/config.js + vendor/supabase.js sudah digenerate
npm run sync:env

# 3. Build web statis ke dist/
npm run build:dist

# 4. Tambahkan platform Android (sekali saja)
npx cap add android

# 5. Sinkronkan dist/ ke proyek Android
npx cap sync android

# 6. Buka Android Studio untuk build GUI, atau CLI:
cd android
./gradlew assembleDebug        # APK debug: android/app/build/outputs/apk/debug/app-debug.apk
# atau release (butuh keystore):
# ./gradlew assembleRelease
```

### iOS (opsional, butuh macOS + Xcode)

```bash
npx cap add ios
npx cap sync ios
npx cap open ios
```

## Plugin native yang dipakai

| Plugin | Fungsi | Lokasi kode |
|---|---|---|
| `@capacitor-mlkit/barcode-scanning` | Pindai QR kamera (deteksi otomatis di `scanner-service.js`) | `src/services/scanner-service.js` (bridge `window.Capacitor.Plugins.BarcodeScanner`) |
| `@capacitor/push-notifications` | Token FCM/APNs -> tabel `device_tokens`, listener terima/tap push | `src/services/push-service.js` (bridge `window.Capacitor.Plugins.PushNotifications`) |
| `@capacitor/local-notifications` | Tampilkan pesan FCM saat app di foreground sbg system notif | `src/services/push-service.js` (bridge `window.Capacitor.Plugins.LocalNotifications`) |

Ketiga plugin diakses via **bridge native** `window.Capacitor.Plugins.*` (tanpa dynamic import npm - proyek tanpa bundler). Di web/browser modul tidak gagal load, fitur hanya nonaktif (fallback input kode manual / status push di profil).

## Konfigurasi push (FCM Android)

1. Buat project di [Firebase Console](https://console.firebase.google.com), tambah aplikasi Android dengan package name `app.klik.chat`.
2. Unduh `google-services.json`, letakkan di `android/app/google-services.json`.
3. Di `android/build.gradle` (root):

   ```gradle
   dependencies {
     classpath 'com.google.gms:google-services:4.4.2'
   }
   ```

4. Di `android/app/build.gradle`:

   ```gradle
   apply plugin: 'com.google.gms.google-services'
   dependencies {
     implementation platform('com.google.firebase:firebase-bom:33.5.1')
     implementation 'com.google.firebase:firebase-messaging'
   }
   ```

5. **Service account (pengiriman dari server)**: Firebase Console -> Project Settings -> Service Accounts -> *Generate new private key*. Simpan file JSON-nya, lalu:

   ```bash
   npx supabase secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat <file-service-account>.json)"
   npx supabase functions deploy notify-push --no-verify-jwt
   ```

6. **Alur otomatis setelah konfigurasi di atas** (tidak perlu langkah manual lagi):
   - Login -> `main.js` memanggil `registerPushToken()` (izin -> token FCM -> tabel `device_tokens`).
   - Kirim pesan -> `chats-service` memanggil Edge Function `notify-push` (fire-and-forget) yang mengirim FCM HTTP v1 ke semua anggota room **kecuali pengirim**.
   - App di **background/tertutup**: system menampilkan notifikasi dari payload `notification` FCM.
   - App di **foreground**: `pushNotificationReceived` -> `LocalNotifications.schedule` -> system notif lokal (dilewati bila chat tujuan sedang terbuka).
   - **Tap notif** (FCM / lokal) -> buka chat tujuan (`data.chatId` / `extra.chatId`).
   - Toggle *Pratinjau pesan* di Profil -> preferensi tersimpan di `device_tokens.settings` -> `notify-push` mengirim "Pesan baru" bila preview mati.
   - Logout -> token dihapus dari `device_tokens`.

APNs (iOS): butuh Apple Developer account, certificate/key di Firebase, `GoogleService-Info.plist` di `ios/App/App/`.

## Troubleshooting

| Gejala | Solusi |
|---|---|
| `npx cap sync` error module not found | jalankan `npm install` dulu |
| Build gradlew gagal `sdk.dir` | set `ANDROID_HOME` / buat `local.properties` berisi `sdk.dir=C\:\\Users\\...\\Android\\Sdk` |
| Kamera scan tidak jalan | pastikan `CAMERA` ada di `android/app/src/main/AndroidManifest.xml` (plugin ML Kit **tidak** menambahkannya otomatis - sudah ditambahkan manual di repo ini: `<uses-permission android:name="android.permission.CAMERA"/>` + `uses-feature` optional). Kalau masih gagal, `npx cap sync android` lalu rebuild. |
| Push token null | cek `google-services.json` + plugin terpasang; lihat logcat `PushNotifications` |
| Izin notifikasi ditolak | Profil -> Notifikasi menampilkan status; aktifkan izin di Pengaturan aplikasi lalu login ulang |
| Notif tidak muncul di background | cek secret `FCM_SERVICE_ACCOUNT_JSON` (`npx supabase secrets list`) + `npx supabase functions deploy notify-push --no-verify-jwt`; log function di Dashboard -> Functions |
| Notif foreground tidak tampil | pastikan `@capacitor/local-notifications` terpasang & `npx cap sync android` dijalankan ulang |
| Tap notif tidak buka chat | lihat logcat `PushNotifications`; payload `data.chatId` harus terkirim (cek isi pesan di function logs) |
| Blank screen di APK | jalankan `npm run sync:env` + `npm run build:dist` sebelum `cap sync` (config.js harus ada) |

## Verifikasi setelah build

1. Install APK di emulator/perangkat, buka KLIK.
2. Buat akun / login (Edge Functions live).
3. Profil -> bagian Notifikasi: status push menampilkan "Push native aktif - token perangkat terdaftar".
4. Friends -> icon QR -> pindai kode teman (kamera) atau input manual.
5. Dua perangkat: kirim pesan saat app satu **di background** -> system notif muncul; tap -> membuka chat yang tepat.
6. Saat app terbuka: pesan masuk tampil juga sebagai system notif (kecuali chat tsb sedang terbuka).
7. Teman Online/Offline terlihat di daftar Teman, header chat, dan subtitle daftar chat.
