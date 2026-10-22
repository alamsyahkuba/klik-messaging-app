/**
 * Push notification token & display (Milestone 6 + perbaikan).
 * Native (Android/iOS via Capacitor): plugin diakses via bridge
 * window.Capacitor.Plugins.* (tanpa dynamic import npm - tanpa bundler).
 *   - registerPushToken(): izin -> token FCM -> tabel device_tokens (RLS insert own).
 *   - Listener: token refresh, pesan diterima (foreground -> system notif lokal),
 *     tap notif -> buka chat tujuan (data.chatId).
 *   - pushStatus(): status izin/token ASLI untuk UI profil (bukan cuma probe import).
 * Web: semua fungsi no-op / null (tanpa error).
 * Setup FCM penuh (google-services.json + secret FCM_SERVICE_ACCOUNT_JSON) di docs/10.
 */
import { isLive, getSupabase } from './supabase.js';
import { currentUserId } from './auth-service.js';
import { isCapacitorRuntime } from './scanner-service.js';
import { getNotificationPrefs } from '../utils/preferences.js';

function detectPlatform() {
  if (typeof window === 'undefined') return 'web';
  const ua = window.navigator?.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'web';
}

/** Plugin push dari bridge Capacitor (native). null bila tidak ada. */
function nativePush() {
  return window.Capacitor?.Plugins?.PushNotifications || null;
}

/** Plugin notifikasi lokal dari bridge Capacitor (native). null bila tidak ada. */
function nativeLocal() {
  return window.Capacitor?.Plugins?.LocalNotifications || null;
}

let listenersBound = false;
let localListenerBound = false;
/** uid & token terakhir yang terdaftar (dipakai unregister saat sesi sudah SIGNED_OUT). */
let registeredUid = null;
let registeredToken = null;
let localNotifSeq = 0;
/** Daftar message ID notifikasi yang sudah ditampilkan di sesi ini (untuk deduplikasi Realtime+FCM). */
let shownMessageIds = new Set();
const MAX_SHOWN_IDS = 100;

function prefsPayload() {
  const prefs = getNotificationPrefs();
  return { messagePreview: !!prefs.messagePreview, sound: !!prefs.sound };
}

function openChatFromNotif(data) {
  const chatId = String(data?.chatId || data?.chat_id || '').trim();
  if (!chatId) return;
  const target = `#/app/chat/${chatId}`;
  if (location.hash !== target) location.hash = target;
}

/**
 * Cek apakah message ID sudah pernah tampil sebagai notifikasi di sesi ini.
 * @param {string} messageId - UUID pesan dari database
 * @returns {boolean}
 */
function isAlreadyShown(messageId) {
  return shownMessageIds.has(messageId);
}

/** Tandaikan message ID sebagai sudah ditampilkan (mencegah duplikan). */
function markShown(messageId) {
  shownMessageIds.add(messageId);
  // Bersihkan terlama jika melebihi batas
  if (shownMessageIds.size > MAX_SHOWN_IDS) {
    const first = [...shownMessageIds].values().next().value;
    if (first) shownMessageIds.delete(first);
  }
}

/** Hapus message ID dari daftar tampil (mis. saat logout atau membaca pesan). */
function clearShown(messageId) {
  shownMessageIds.delete(messageId);
}

/** Bersihkan seluruh daftar ID notifikasi (panggil saat logout/sesi beranti). */
function clearAllShown() {
  shownMessageIds.clear();
}

/** Simpan/update token di device_tokens (hapus dulu token lama utk platform ini). */
async function persistToken(uid, token, platform) {
  const sb = getSupabase();
  // Hapus token lama user ini dulu
  await sb.from('device_tokens').delete().eq('user_id', uid).eq('platform', platform);

  // Insert token baru – client ini akan otomatis membawa session user yang login
  const { error, data } = await sb.from('device_tokens')
    .insert({ user_id: uid, token, platform, settings: prefsPayload() })
    .select(); // ambil barisan yang dibuat untuk cek

  if (error) {
    console.warn('device_tokens insert gagal (policy/permission):', error.message);
    console.warn('data dari insert:', data);
    // Coba fallback: gunakan raw client dengan token manual dari session
    try {
      const { error: rawErr, data: rawData } = await sb
        .from('device_tokens')
        .insert({ user_id: uid, token, platform, settings: prefsPayload() })
        .select();
      console.warn('device_tokens fallback insert gagal:', rawErr?.message, rawData);
    } catch (e) {
      console.error('device_tokens fallback error:', e);
    }
  } else {
    console.log('device_tokens berhasil disimpan, baris:', data?.length, 'row(s)');
  }
  return !error;
}

/** Tampilkan pesan FCM yang diterima saat app di foreground sbg system notif lokal. */
async function showLocalNotif({ title, body, chatId, messageId }) {
  const Local = nativeLocal();
  if (!Local?.schedule) return;

  // Jangan tampilkan notif kalau chat tujuan sedang terbuka & app aktif.
  if (chatId && location.hash === `#/app/chat/${chatId}`) return;

  // Gunakan messageId sebagai ID notifikasi stabil (jika tersedia)
  let notifId = (localNotifSeq++ % 2147483647);
  if (messageId) {
    // Hash messageId ke integer stabil 1-N
    const hash = Number.parseInt(
      require('crypto').createHash('sha256').update(messageId).digest('hex'), 16,
    );
    notifId = (hash % 2147483647) + 1;
  }

  // Request izin jika belum granted
  try {
    const permission = await Local.checkPermissions();
    if (permission.display !== 'granted') {
      const renewed = await Local.requestPermissions();
      if (renewed.display !== 'granted') {
        console.warn('Izin local notification belum granted, skip notif');
        return;
      }
    }
  } catch { /* abaikan jika permission check gagal */ }

  localNotifSeq = (localNotifSeq + 1) % 2147483647;
  try {
    await Local.schedule({
      notifications: [{
        id: notifId,
        title: title || 'Pesan baru',
        body: body || '',
        extra: { chatId: chatId || '', messageId: messageId || '' },
      }],
    });
  } catch { /* layar notif tidak tersedia - abaikan */ }
}

/** Pasang listener sekali per sesi aplikasi. */
async function bindListeners() {
  if (listenersBound) return;
  const Push = nativePush();
  if (!Push?.addListener) return;
  listenersBound = true;
  try {
    await Push.addListener('registration', (token) => {
      const value = token?.value;
      if (!value) return;
      registeredToken = value;
      if (registeredUid && isLive()) {
        persistToken(registeredUid, value, detectPlatform()).catch(() => { /* abaikan */ });
      }
    });

    await Push.addListener('pushNotificationReceived', (notification) => {
      const data = notification?.data || {};
      const messageId = String(data.messageId || data?.message_id || '');

      // Lewati jika message ID sudah ditampilkan (deduplikasi Realtime+FCM)
      if (messageId && isAlreadyShown(messageId)) {
        console.log('Skip FCM: message already shown, id=', messageId);
        return;
      }

      showLocalNotif({
        title: notification?.title || 'Pesan baru',
        body: notification?.body || '',
        chatId: String(data.chatId || ''),
      }).catch(() => { /* abaikan */ });

      // Tandaikan ID setelah ditampilkan (hanya jika ada messageId valid)
      if (messageId) markShown(messageId);
    });

    await Push.addListener('pushNotificationActionPerformed', async (event) => {
      openChatFromNotif(event?.notification?.data);

      // Tandai kamar sebagai terbaca saat notifikasi ditekan (fire-and-forget)
      try {
        const sb = getSupabase();
        let uid = registeredUid;
        if (!uid) {
          const session = await currentUserId();
          uid = session?.user?.id ?? null;
        }
        if (uid) {
          await sb.rpc('mark_room_read', { p_room: event?.notification?.data?.chatId || '' }).then(({ error }) => {
            if (error) console.warn('mark_room_read dari notif tap gagal:', error.message);
          }).catch(() => { /* abaikan */ });
        }
      } catch { /* abaikan */ }
    });
  } catch {
    listenersBound = false;
  }
}

/** Terima notifikasi FCM (foreground & background). */
export async function bindPushNotificationListener() {
  if (listenersBound) return;
  const Push = nativePush();
  if (!Push?.addListener) return;
  listenersBound = true;
  try {
    await Push.addListener('pushNotificationReceived', async (notification) => {
      console.log(
        'FCM NOTIFICATION RECEIVED:',
        JSON.stringify(notification)
      );

      const data = notification?.data || {};
      const messageId = String(data.messageId || data?.message_id || '');

      // Lewati jika message ID sudah pernah ditampilkan (deduplikasi dengan Realtime)
      if (messageId && isAlreadyShown(messageId)) {
        console.log('Skip FCM: message already shown via Realtime, id=', messageId);
        // Masih perlu update UI jika aplikasi sedang terbuka di chat lain
        return;
      }

      // Menampilkan notifikasi lokal saat app foreground
      try {
        const Local = nativeLocal();
        if (!Local?.schedule) return;

        let permission = await Local.checkPermissions();
        if (permission.display !== 'granted') {
          permission = await Local.requestPermissions();
          if (permission.display !== 'granted') {
            console.warn('Izin local notification belum granted');
            return;
          }
        }

        const title = notification.title || 'KLIK';
        const body = notification.body || 'Kamu menerima pesan baru.';

        await showLocalNotif({
          title,
          body,
          chatId: String(data.chatId || ''),
          messageId,
        });

        // Tandaikan ID setelah ditampilkan (hanya jika messageId valid)
        if (messageId) markShown(messageId);

        console.log(
          'Foreground local notification berhasil dijadwalkan',
          { title, body }
        );
      } catch (localErr) {
        console.error('Foreground notification error:', localErr);
      }
    });
  } catch {
    listenersBound = false;
  }
}

/** Tap system notif hasil local schedule (foreground) -> buka chat. */
async function bindLocalListener() {
  if (localListenerBound) return;
  const Local = nativeLocal();
  if (!Local?.addListener) return;
  localListenerBound = true;
  try {
    await Local.addListener('localNotificationActionPerformed', (event) => {
      openChatFromNotif(event?.notification?.extra);
    });
  } catch {
    localListenerBound = false;
  }
}

/**
 * Daftarkan token perangkat untuk user sesi aktif (otomatis setelah login).
 * @returns {Promise<{ token: string, platform: string } | null>}
 *   null = lingkungan tanpa push (web / plugin absen / izin ditolak / sesi mati).
 */
export async function registerPushToken() {
  try {
    console.log('registerPushToken: START - isCapacitorRuntime check');
    if (!isCapacitorRuntime() || !isLive()) {
      console.log('registerPushToken: early return (not Capacitor runtime or not live)');
      return null;
    }
    console.log('registerPushToken: Capacitor runtime & live context confirmed');

    const Push = nativePush();
    if (!Push?.register || !Push?.addListener) return null;

    console.log('registerPushToken: bindListeners dimulai');

    // Daftar listener registration terlebih dahulu agar token siap diterima
    const tokenPromise = new Promise((resolve, reject) => {
      let timeoutId;

      const cleanup = async () => {
        clearTimeout(timeoutId);
        await Promise.allSettled([registrationHandle?.remove(), errorHandle?.remove()]);
      };

      let registrationHandle;
      let errorHandle;

      timeoutId = setTimeout(async () => {
        await cleanup();
        reject(new Error('Timeout waiting for FCM token'));
      }, 30000);

      Promise.all([
        Push.addListener('registration', async (result) => {
          await cleanup();
          resolve(result.value);
        }),
        Push.addListener('registrationError', async (error) => {
          await cleanup();
          reject(error);
        }),
      ]).then(([regHandle, errHandle]) => {
        registrationHandle = regHandle;
        errorHandle = errHandle;
      }).catch(async (err) => {
        await cleanup();
        reject(err);
      });
    });

    console.log('registerPushToken: requestPermissions');
    const perm = await Push.requestPermissions().catch(() => null);
    console.log('registerPushToken: permission result:', perm);
    if (perm?.receive !== 'granted') return null;

    console.log('registerPushToken: invoking register');
    await Push.register();

    console.log('registerPushToken: waiting for token from event');
    const token = await tokenPromise;

    console.log(
      'FCM token received:',
      token.substring(0, 10) + '...'
    );

    const uid = await currentUserId();
    console.log('registerPushToken: userId', uid);
    if (!uid) return null;

    const platform = detectPlatform();
    console.log(
      'registerPushToken: persistToken dimulai, uid=',
      uid,
      'token=',
      token.substring(0, 10) + '...',
      'platform=',
      platform
    );
    const ok = await persistToken(uid, token, platform).catch((e) => {
      console.error('registerPushToken: persistToken error', e);
      return false;
    });
    console.log('registerPushToken: persistToken result', ok);
    registeredUid = uid;
    registeredToken = token;
    return ok ? { token, platform } : null;
  } catch (e) {
    console.error('registerPushToken: unexpected error', e);
    return null;
  }
}

/** Hapus token perangkat ini dari DB (mis. saat logout; sesi sudah ditutup). */
export async function unregisterPushToken() {
  try {
    clearAllShown();
    let uid = registeredUid;
    if (!uid) {
      const session = await currentUserId();
      uid = session?.user?.id ?? null;
    }
    registeredUid = null;
    registeredToken = null;
    if (!uid || !isLive()) return;
    const sb = getSupabase();
    await sb.from('device_tokens').delete().eq('user_id', uid).eq('platform', detectPlatform());
  } catch { /* abaikan */ }
}

/**
 * Sinkronkan preferensi notifikasi (profil) ke baris device_tokens milik sendiri.
 * Dibaca Edge Function notify-push utk menentukan preview pesan.
 */
export async function syncPushSettings(prefs) {
  try {
    if (!isLive()) return;
    let uid = registeredUid;
    if (!uid) {
      const session = await currentUserId();
      uid = session?.user?.id ?? null;
    }
    if (!uid) return;
    const sb = getSupabase();
    const settings = {
      messagePreview: !!prefs?.messagePreview,
      sound: !!prefs?.sound,
    };
    const { error } = await sb.from('device_tokens').update({ settings }).eq('user_id', uid);
    if (error) console.warn('device_tokens update settings gagal:', error.message);
  } catch { /* abaikan */ }
}

/** Status asli untuk UI profil (izin, token, ketersediaan plugin). */
export async function pushStatus() {
  if (!isCapacitorRuntime()) {
    return { available: false, granted: false, reason: 'Push notifications tersedia di aplikasi Android/iOS.' };
  }
  const Push = nativePush();
  if (!Push) {
    return { available: false, granted: false, reason: 'Plugin push belum terpasang di build native (lihat docs/10).' };
  }
  let granted = false;
  try {
    const perm = await Push.checkPermissions();
    granted = perm?.receive === 'granted';
  } catch { /* cek gagal - perlakukan belum izin */ }
  if (!granted) {
    return {
      available: true,
      granted: false,
      reason: 'Izin notifikasi belum diberikan. Izinkan notifikasi agar pesan tampil sebagai system notif.',
    };
  }
  if (!registeredToken) {
    return {
      available: true,
      granted: true,
      reason: 'Izin diberikan, tetapi token belum terdaftar. Coba login ulang (lihat docs/10).',
    };
  }
  return {
    available: true,
    granted: true,
    reason: 'Push native aktif - token perangkat terdaftar. Pesan masuk tampil sebagai system notif.',
  };
}
