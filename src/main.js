/**
 * Bootstrap aplikasi.
 * Jalankan di browser: <script type="module" src="src/main.js"></script>
 */
import { route, startRouter, navigate } from './router/router.js';
import { applyTheme, getTheme } from './utils/preferences.js';
import { setAppHeight } from './utils/viewport.js';
import { isLive, getSupabase } from './services/supabase.js';
import { currentSession } from './services/auth-service.js';
import { registerPushToken, unregisterPushToken, bindPushNotificationListener } from './services/push-service.js';
import { subscribeForegroundNotifications, unsubscribeForegroundNotifications, clearNotificationsForRoom } from './services/foreground-notifications.js';
import { startPresence, stopPresence } from './services/presence-service.js';

import { welcomePage } from './pages/welcome.js';
import { createAccountPage } from './pages/create-account.js';
import { loginPage } from './pages/login.js';
import { homePage } from './pages/home.js';
import { friendsPage } from './pages/friends.js';
import { chatPage } from './pages/chat.js';
import { profilePage } from './pages/profile.js';

/**
 * Guard rute #/app/*: di mode live, tanpa sesi -> lempar ke halaman Masuk.
 * Toleran terhadap cold-start: token yang masih tersimpan di localStorage
 * berarti pernah login & BELUM logout manual (logout menghapus token).
 * Kalau sesi belum terbaca (refresh tertunda/gagal sementara saat boot),
 * jangan redirect - jadwalkan probe ulang. (Mode demo / uji otomatis: nonaktif.)
 */
let authReady = false;
let probeTimer = 0;

/** Token Supabase masih tersimpan? (sb-<ref>-auth-token) */
function hasStoredToken() {
  try {
    return Object.keys(localStorage).some(
      (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
    );
  } catch {
    return false;
  }
}

function queueSessionProbe(delay = 5000) {
  if (probeTimer) return;
  probeTimer = setTimeout(() => {
    probeTimer = 0;
    guardSession();
  }, delay);
}

function guardSession() {
  if (!isLive()) return;
  const path = (location.hash.slice(1) || '/').split('?')[0];
  if (!path.startsWith('/app')) return;
  currentSession().then((session) => {
    if (session) return;
    // Belum settle -> jangan redirect (fase boot / refresh tertunda).
    if (!authReady) return;
    // Token masih ada -> sesi sedang dipulihkan atau refresh ditunda jaringan.
    // BUKAN logout: probe ulang nanti. Logout manual menghapus token, jadi
    // kondisi "token ada tanpa sesi" selesai dengan sendirinya.
    if (hasStoredToken()) {
      queueSessionProbe();
      return;
    }
    if (location.hash !== '#/login') location.hash = '#/login';
  }).catch(() => { /* biarkan halaman menampilkan panel error sendiri */ });
}

/** Cold start Android (hash kosong -> Welcome): kalau sesi/token masih ada,
 * buka langsung ke aplikasi supaya user tidak perlu login ulang. */
function resumeIfAuthed() {
  if (!isLive()) return;
  const onEntry = () => ['', '#/', '#/welcome'].includes(location.hash);
  if (!onEntry()) return;
  const openApp = () => {
    if (onEntry()) navigate('/app/chats', { replace: true });
  };
  currentSession().then((session) => {
    if (session) { openApp(); return; }
    // Sesi belum terbaca tapi token masih ada -> recover pending, buka app
    // (guard akan menyelesaikan pemulihan). Tanpa token -> memang belum login.
    if (hasStoredToken()) openApp();
  }).catch(() => { /* tetap di welcome */ });
}

function watchAuth() {
  if (!isLive()) return;
  try {
    const sb = getSupabase();
    sb.auth.onAuthStateChange((event, session) => {
      if (['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'SIGNED_OUT'].includes(event)) {
        authReady = true;
        guardSession(); // evaluasi ulang setelah auth settle (mis. refresh berhasil)
      }
      // Push token + presence ikut siklus sesi (otomatis setelah login).
      if (event === 'SIGNED_OUT') {
        stopPresence();
        unregisterPushToken().catch(() => { /* abaikan */ });
        unsubscribeForegroundNotifications().catch(() => { /* abaikan */ });
      } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        startPresence().catch(() => { /* abaikan */ });
        registerPushToken().catch(() => { /* abaikan */ });
        subscribeForegroundNotifications(session.user.id).catch((e) => {
          console.error('Gagal subscribe foreground notifications:', e);
        });
      }
    });
  } catch { /* vendor belum termuat - guardSession tetap jalan tanpa authReady */ }
}

export function init() {
  applyTheme(getTheme());
  setAppHeight();
  window.addEventListener('resize', setAppHeight);
  window.visualViewport?.addEventListener('resize', setAppHeight);
  window.visualViewport?.addEventListener('scroll', () => {
    // WebView M139+: keyboard resize visual viewport saja; sinkronkan scroll.
    if ((window.visualViewport?.offsetTop || 0) > 0) window.scrollTo(0, 0);
  });

  route('/', welcomePage);
  route('/welcome', welcomePage);
  route('/create-account', createAccountPage);
  route('/login', loginPage);
  route('/app/chats', homePage);
  route('/app/friends', friendsPage);
  route('/app/profile', profilePage);
  route('/app/chat/:id', chatPage);

  const root = document.getElementById('app');
  startRouter(root);
  watchAuth();
  bindPushNotificationListener();
  window.addEventListener('hashchange', async (e) => {
    await guardSession();
    // Bersihkan notifikasi lokal terkait ruangan chat saat navigasi
    const hash = (location.hash.slice(1) || '').split('?')[0];
    if (hash.startsWith('/app/chat/')) {
      const chatId = hash.replace('/app/chat/', '');
      clearNotificationsForRoom(chatId);
    }
  });
  // Jaringan kembali -> refresh sesi tertunda (cooldown refresh) bisa dicoba lagi cepat.
  window.addEventListener('online', () => { if (isLive()) queueSessionProbe(1000); });
  guardSession();
  resumeIfAuthed();
}

if (typeof document !== 'undefined') {
  init();
}
