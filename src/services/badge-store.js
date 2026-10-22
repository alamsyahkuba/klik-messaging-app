/**
 * Badge store sederhana (pub/sub) untuk angka navbar:
 * - unreadChats    : total pesan belum dibaca (tab Pesan)
 * - pendingFriends : permintaan pertemanan masuk (tab Teman)
 * Dipakai _shell.js (subscribe/update) dan halaman chats/friends (setBadges).
 */

let state = {
  unreadChats: 0,
  pendingFriends: 0,
};

const listeners = new Set();

/** @returns {{unreadChats:number,pendingFriends:number}} salinan state saat ini. */
export function getBadges() {
  return { ...state };
}

/**
 * Perbarui sebagian state badge lalu beri tahu subscriber.
 * @param {{unreadChats?:number,pendingFriends?:number}} partial
 */
export function setBadges(partial) {
  let changed = false;
  for (const [key, value] of Object.entries(partial)) {
    if (key in state && typeof value === 'number' && state[key] !== value) {
      state[key] = value;
      changed = true;
    }
  }
  if (!changed) return;
  const snapshot = getBadges();
  for (const fn of listeners) {
    try { fn(snapshot); } catch { /* abaikan listener rusak */ }
  }
}

/**
 * Berlangganan perubahan badge.
 * @param {(badges:{unreadChats:number,pendingFriends:number}) => void} fn
 * @returns {() => void} fungsi unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
