/**
 * Preferensi lokal (theme & notifikasi) - disimpan di localStorage.
 * Tidak berisi data rahasia.
 */

const KEY_THEME = 'klik:theme';
const KEY_NOTIF = 'klik:notifications';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* mode privat / storage penuh - abaikan, preferensi hanya opsional */
  }
}

export function getTheme() {
  return safeGet(KEY_THEME) || 'auto';
}

export function setTheme(theme) {
  safeSet(KEY_THEME, theme);
  applyTheme(theme);
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function getNotificationPrefs() {
  try {
    return { messagePreview: true, sound: true, ...(JSON.parse(safeGet(KEY_NOTIF) || '{}')) };
  } catch {
    return { messagePreview: true, sound: true };
  }
}

export function setNotificationPrefs(prefs) {
  safeSet(KEY_NOTIF, JSON.stringify(prefs));
}
