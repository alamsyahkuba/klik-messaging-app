/**
 * Presence Online/Offline teman (Supabase Realtime Presence).
 * Setiap klien yang login melakukan .track({ uid }) di channel global;
 * status "online" = minimal satu perangkat user tersebut sedang terhubung.
 * Mode demo / web / tanpa sesi: no-op (isOnline selalu false).
 */
import { isLive, getSupabase } from './supabase.js';
import { currentUserId } from './auth-service.js';

const CHANNEL = 'klik-presence';
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const NOTIFY_COALESCE_MS = 200;

const listeners = new Set();
const online = new Set();

let channel = null;
let myUid = null;
let attempt = 0;
let retryTimer = 0;
let notifyTimer = 0;
let wakeBound = false;

function notifySoon() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = 0;
    for (const cb of listeners) {
      try { cb(); } catch { /* listener error - abaikan */ }
    }
  }, NOTIFY_COALESCE_MS);
}

function syncFrom(ch) {
  const state = ch.presenceState() || {};
  online.clear();
  for (const key of Object.keys(state)) online.add(key);
  notifySoon();
}

function clearRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0; }
}

function scheduleRetry() {
  if (retryTimer || !channel) return;
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  attempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = 0;
    reconnect();
  }, delay);
}

function teardownChannel() {
  if (!channel) return;
  try { getSupabase().removeChannel(channel); } catch { /* vendor siap - abaikan */ }
  channel = null;
}

function connect() {
  if (!myUid) return;
  const sb = getSupabase();
  teardownChannel();
  const ch = sb.channel(CHANNEL, { config: { presence: { key: myUid } } });
  ch.on('presence', { event: 'sync' }, () => syncFrom(ch))
    .on('presence', { event: 'join' }, ({ key }) => { if (key) { online.add(key); notifySoon(); } })
    .on('presence', { event: 'leave' }, ({ key }) => { if (key) { online.delete(key); notifySoon(); } })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        attempt = 0;
        ch.track({ uid: myUid, at: Date.now() }).catch(() => { /* abaikan */ });
        syncFrom(ch);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        scheduleRetry();
      }
    });
  channel = ch;
}

function reconnect() {
  if (!myUid || !isLive()) return;
  clearRetry();
  attempt = 0;
  connect();
}

/** App kembali aktif / jaringan pulih: pastikan channel presence ikut pulih. */
function handleWake() {
  if (!myUid || !isLive()) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (channel && channel.state === 'joined') {
    // socket mungkin zombie - track ulang memaksa join state sinkron.
    channel.track({ uid: myUid, at: Date.now() }).catch(() => scheduleRetry());
    return;
  }
  reconnect();
}

function bindWake() {
  if (wakeBound || typeof window === 'undefined') return;
  wakeBound = true;
  window.addEventListener('online', handleWake);
  document.addEventListener('visibilitychange', handleWake);
}

/** Mulai presence utk user sesi aktif. Idempoten. @returns {Promise<boolean>} */
export async function startPresence() {
  if (!isLive()) return false;
  if (channel) return true;
  let uid = null;
  try { uid = await currentUserId(); } catch { uid = null; }
  if (!uid) return false;
  myUid = uid;
  attempt = 0;
  bindWake();
  connect();
  return true;
}

/** Hentikan presence (logout). State online dibersihkan. */
export function stopPresence() {
  clearRetry();
  if (notifyTimer) { clearTimeout(notifyTimer); notifyTimer = 0; }
  teardownChannel();
  online.clear();
  myUid = null;
  attempt = 0;
  notifySoon();
}

/** Apakah user (uid) sedang online? Demo/tanpa start -> false. */
export function isOnline(uid) {
  if (!uid) return false;
  return online.has(uid);
}

/** Snapshot Set uid yang sedang online. */
export function getOnlineSnapshot() {
  return new Set(online);
}

/**
 * Berlangganan perubahan presence (coalesce ~200ms).
 * @returns {() => void} unsubscribe.
 */
export function subscribePresence(callback) {
  if (typeof callback !== 'function') return () => {};
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}
