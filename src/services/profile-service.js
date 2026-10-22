/**
 * Service profil (Milestone 3).
 * Mode live : tabel profiles lewat sesi Supabase Auth (RLS: hanya milik sendiri).
 * Mode demo : data dummy Milestone 1.
 */
import { me } from '../data/dummy.js';
import { respond, ServiceError } from './_fake.js';
import { isLive, getSupabase } from './supabase.js';
import { currentUserId, readStoredRecoveryKey } from './auth-service.js';

function demoShape() {
  return { ...me };
}

function liveShape(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    publicCode: row.public_code,
    status: row.status || '',
    avatarUrl: row.avatar_url || '',
    createdAt: row.created_at,
  };
}

async function fetchOwnProfile() {
  const sb = getSupabase();
  const id = await currentUserId();
  if (!id) throw new ServiceError('Sesi berakhir. Silakan masuk kembali.', 'UNAUTHENTICATED');
  const { data, error } = await sb.from('profiles').select('*').eq('id', id).single();
  if (error || !data) {
    throw new ServiceError('Gagal memuat profil. Coba lagi.', 'NETWORK');
  }
  return liveShape(data);
}

export async function getProfile({ state = 'ok' } = {}) {
  if (state !== 'ok') {
    return respond(demoShape, { state, delay: 200 });
  }
  if (!isLive()) return respond(demoShape, { delay: 200 });
  return fetchOwnProfile();
}

const NAME_RE = /^[\p{L}\p{N} ._'-]+$/u;

export async function updateDisplayName(rawName) {
  const name = String(rawName ?? '').trim();
  if (name.length < 2) throw new ServiceError('Nama tampilan minimal 2 karakter.', 'VALIDATION');
  if (name.length > 30) throw new ServiceError('Nama tampilan maksimal 30 karakter.', 'VALIDATION');
  if (!NAME_RE.test(name)) {
    throw new ServiceError('Nama tampilan hanya boleh berisi huruf, angka, spasi, titik, apostrof, strip.', 'VALIDATION');
  }

  if (!isLive()) {
    await respond(null, { delay: 320 });
    me.displayName = name;
    return { ...me };
  }

  const sb = getSupabase();
  const id = await currentUserId();
  if (!id) throw new ServiceError('Sesi berakhir. Silakan masuk kembali.', 'UNAUTHENTICATED');
  const { data, error } = await sb
    .from('profiles')
    .update({ display_name: name })
    .eq('id', id)
    .select()
    .single();
  if (error || !data) {
    throw new ServiceError('Gagal menyimpan nama. Coba lagi.', 'NETWORK');
  }
  return liveShape(data);
}

/**
 * Info pemulihan untuk ditampilkan di profil.
 * Live: recovery key hanya ada bila baru dibuat/dipulihkan di perangkat ini
 * (server hanya menyimpan hash-nya).
 */
export function recoveryInfo() {
  const warning = 'Simpan recovery key di tempat aman. Jika kode akun DAN recovery key hilang bersamaan, akun tidak dapat dipulihkan.';
  if (!isLive()) {
    return { publicCode: me.publicCode, recoveryKey: me.recoveryKey, warning };
  }
  return {
    publicCode: '',
    recoveryKey: readStoredRecoveryKey(),
    warning,
  };
}
