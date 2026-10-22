/**
 * Service autentikasi KLIK (Milestone 3).
 * Mode live : memanggil Edge Functions auth-register/login/recover lalu
 *             menyetel sesi Supabase Auth (disimpan supabase-js di localStorage).
 * Mode demo : perilaku Milestone 1 (identitas lokal, tanpa jaringan) -
 *             dipakai oleh uji otomatis Node dan saat config kosong.
 * Kode akun publik BUKAN kredensial; passphrase = satu-satunya rahasia
 * (dengan recovery key untuk pemulihan).
 */
import { isLive, getSupabase } from './supabase.js';
import { ServiceError, wait } from './_fake.js';
import { me } from '../data/dummy.js';
import { normalizeAccountCode } from '../utils/id.js';

const RECOVERY_STORAGE_KEY = 'klik.recovery_key';
const NAME_RE = /^[\p{L}\p{N} ._'-]+$/u;

function codeBlock() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generatePublicCode() {
  return `KLIK-${codeBlock()}-${codeBlock()}`;
}

function generateRecoveryKey() {
  return `RCV-${codeBlock()}-${codeBlock()}-${codeBlock()}-${codeBlock()}`;
}

function validateDisplayName(name) {
  if (name.length < 2 || name.length > 30 || !NAME_RE.test(name)) {
    throw new ServiceError(
      'Nama tampilan harus 2-30 karakter (huruf, angka, spasi, . _ \').',
      'VALIDATION',
    );
  }
}

function validatePassphrase(passphrase) {
  if (passphrase.length < 8 || passphrase.length > 128) {
    throw new ServiceError('Passphrase minimal 8 karakter.', 'VALIDATION');
  }
}

/** Simpan/hapus salinan lokal recovery key (hanya untuk ditampilkan di profil). */
export function storeRecoveryKey(key) {
  try {
    if (key) localStorage.setItem(RECOVERY_STORAGE_KEY, key);
  } catch { /* storage penuh/di-block - abaikan */ }
}

export function readStoredRecoveryKey() {
  try {
    return localStorage.getItem(RECOVERY_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function clearStoredRecoveryKey() {
  try {
    localStorage.removeItem(RECOVERY_STORAGE_KEY);
  } catch { /* abaikan */ }
}

function mapFunctionError(error, fallback) {
  const message = error?.message || '';
  if (!message) return new ServiceError(fallback, 'UNKNOWN');
  if (message.includes('passphrase') || message.includes('Kode akun')) {
    return new ServiceError(message, 'INVALID_CREDENTIALS');
  }
  if (message.includes('recovery')) return new ServiceError(message, 'INVALID_RECOVERY');
  if (message.includes('Terlalu banyak')) return new ServiceError(message, 'RATE_LIMITED');
  return new ServiceError(message, 'AUTH_ERROR');
}

async function applySession(session) {
  const sb = getSupabase();
  const { error } = await sb.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw new ServiceError('Gagal menyimpan sesi. Coba masuk lagi.', 'SESSION');
}

/**
 * Buat akun baru. Mengembalikan { profile: {id, displayName, publicCode}, recoveryKey }.
 * Recovery key hanya dikirim SEKALI oleh server.
 */
export async function registerAccount({ displayName, passphrase }) {
  const name = String(displayName ?? '').trim();
  validateDisplayName(name);
  validatePassphrase(String(passphrase ?? ''));

  if (isLive()) {
    try {
      const sb = getSupabase();
      const { data, error } = await sb.functions.invoke('auth-register', {
        body: { display_name: name, passphrase },
      });
      if (error) throw mapFunctionError(error, 'Gagal membuat akun. Coba lagi.');
      if (data?.error) throw new ServiceError(data.error.message, data.error.code || 'AUTH_ERROR');
      await applySession(data.session);
      storeRecoveryKey(data.recovery_key);
      return {
        profile: {
          id: data.profile.id,
          displayName: data.profile.display_name,
          publicCode: data.profile.public_code,
        },
        recoveryKey: data.recovery_key,
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('Gagal membuat akun. Periksa koneksi lalu coba lagi.', 'NETWORK');
    }
  }

  /* --- Mode demo (uji otomatis / tanpa config) --- */
  await wait(700);
  const identity = {
    internalId: `usr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    publicCode: generatePublicCode(),
    recoveryKey: generateRecoveryKey(),
    displayName: name,
  };
  me.displayName = identity.displayName;
  me.publicCode = identity.publicCode;
  me.recoveryKey = identity.recoveryKey;
  storeRecoveryKey(identity.recoveryKey);
  return { profile: { id: identity.internalId, displayName: name, publicCode: identity.publicCode }, recoveryKey: identity.recoveryKey };
}

/** Masuk dengan kode akun + passphrase. Mengembalikan { profile }. */
export async function loginWithPassphrase({ publicCode, passphrase }) {
  const code = normalizeAccountCode(publicCode);
  if (!/^KLIK[A-Z0-9]{8}$/.test(code)) {
    throw new ServiceError('Format kode akun tidak valid. Contoh: KLIK-7Q2M-9X4D.', 'INVALID_FORMAT');
  }
  validatePassphrase(String(passphrase ?? ''));

  if (isLive()) {
    try {
      const sb = getSupabase();
      const { data, error } = await sb.functions.invoke('auth-login', {
        body: { public_code: code, passphrase },
      });
      if (error) throw mapFunctionError(error, 'Gagal masuk. Coba lagi.');
      if (data?.error) throw new ServiceError(data.error.message, data.error.code || 'AUTH_ERROR');
      await applySession(data.session);
      return {
        profile: {
          id: data.profile.id,
          displayName: data.profile.display_name,
          publicCode: data.profile.public_code,
        },
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('Gagal masuk. Periksa koneksi lalu coba lagi.', 'NETWORK');
    }
  }

  /* --- Mode demo --- */
  await wait(650);
  return { profile: { id: me.id, displayName: me.displayName, publicCode: me.publicCode } };
}

/**
 * Pulihkan akun dengan recovery key, sekaligus mengganti passphrase.
 * Mengembalikan { profile, recoveryKey } (recovery key BARU).
 */
export async function recoverAccount({ publicCode, recoveryKey, newPassphrase }) {
  const code = normalizeAccountCode(publicCode);
  if (!/^KLIK[A-Z0-9]{8}$/.test(code)) {
    throw new ServiceError('Format kode akun tidak valid.', 'INVALID_FORMAT');
  }
  const key = String(recoveryKey ?? '').trim().toUpperCase();
  if (!/^RCV(-[A-Z0-9]{4}){4}$/.test(key)) {
    throw new ServiceError('Format recovery key tidak valid. Contoh: RCV-XXXX-XXXX-XXXX-XXXX.', 'INVALID_FORMAT');
  }
  validatePassphrase(String(newPassphrase ?? ''));

  if (isLive()) {
    try {
      const sb = getSupabase();
      const { data, error } = await sb.functions.invoke('auth-recover', {
        body: { public_code: code, recovery_key: key, new_passphrase: newPassphrase },
      });
      if (error) throw mapFunctionError(error, 'Gagal memulihkan akun. Coba lagi.');
      if (data?.error) throw new ServiceError(data.error.message, data.error.code || 'AUTH_ERROR');
      await applySession(data.session);
      clearStoredRecoveryKey();
      storeRecoveryKey(data.recovery_key);
      return {
        profile: {
          id: data.profile.id,
          displayName: data.profile.display_name,
          publicCode: data.profile.public_code,
        },
        recoveryKey: data.recovery_key,
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('Gagal memulihkan akun. Periksa koneksi lalu coba lagi.', 'NETWORK');
    }
  }

  /* --- Mode demo --- */
  await wait(700);
  me.recoveryKey = generateRecoveryKey();
  storeRecoveryKey(me.recoveryKey);
  return {
    profile: { id: me.id, displayName: me.displayName, publicCode: me.publicCode },
    recoveryKey: me.recoveryKey,
  };
}

/** Sesi aktif Supabase (null bila belum masuk). */
export async function currentSession() {
  if (!isLive()) return { user: { id: me.id } };
  const sb = getSupabase();
  const { data } = await sb.auth.getSession();
  return data?.session ?? null;
}

export async function currentUserId() {
  const session = await currentSession();
  return session?.user?.id ?? null;
}

export async function logout() {
  clearStoredRecoveryKey();
  if (!isLive()) return;
  const sb = getSupabase();
  await sb.auth.signOut();
}
