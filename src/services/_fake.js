/**
 * Utilitas simulasi backend untuk Milestone 1.
 * - state 'loading' : tidak pernah selesai (untuk pratinjau skeleton)
 * - state 'error'   : selalu melempar error (untuk pratinjau panel error)
 * - state 'empty'   : selalu mengembalikan daftar kosong (untuk pratinjau empty state)
 * Penggantian dengan Supabase terjadi di Milestone 2+ tanpa mengubah halaman.
 */

export class ServiceError extends Error {
  constructor(message, code = 'UNKNOWN') {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
  }
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const never = () => new Promise(() => {});

export async function respond(data, { state = 'ok', delay = 340 } = {}) {
  if (state === 'loading') return never();
  await wait(delay);
  if (state === 'error') throw new ServiceError('Gagal memuat data. Periksa koneksi lalu coba lagi.', 'DEMO_ERROR');
  if (state === 'empty') return [];
  return typeof data === 'function' ? data() : data;
}

export function requireText(value, label, { min = 1, max = 500 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min) throw new ServiceError(`${label} minimal ${min} karakter.`, 'VALIDATION');
  if (text.length > max) throw new ServiceError(`${label} maksimal ${max} karakter.`, 'VALIDATION');
  return text;
}
