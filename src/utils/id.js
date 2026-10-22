/** ID unik untuk operasi lokal (pending message, dsb). Bukan primary key database. */
export function localId(prefix = 'loc') {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** Hash deterministik kecil untuk memilih warna avatar dari nama. */
export function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Ambil 1-2 huruf awal nama untuk inisial avatar. */
export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Toleransi untuk input kode akun: huruf besar/kecil, spasi, strip. */
export function normalizeAccountCode(input) {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '');
}

/**
 * Rapikan kode ke format kanonik yang disimpan di database & dikirim ke RPC:
 * KLIK-XXXX-XXXX (pakai strip). Mengembalikan string kosong bila tidak valid.
 */
export function formatAccountCode(input) {
  const raw = normalizeAccountCode(input);
  if (!/^KLIK[A-Z0-9]{8}$/.test(raw)) return '';
  return `KLIK-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}
