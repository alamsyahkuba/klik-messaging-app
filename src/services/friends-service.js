/**
 * Service pertemanan (Milestone 3).
 * Mode live : tabel friend_requests/friendships + RPC (RLS + security definer).
 * Mode demo : data dummy Milestone 1 (dipakai uji otomatis Node).
 * Bentuk data yang dikembalikan tetap sama dengan Milestone 1 agar halaman
 * tidak berubah.
 */
import {
  friendIds,
  incomingRequests,
  outgoingRequests,
  me,
  users,
} from '../data/dummy.js';
import { respond, ServiceError } from './_fake.js';
import { formatAccountCode, normalizeAccountCode } from '../utils/id.js';
import { isLive, getSupabase } from './supabase.js';
import { currentUserId } from './auth-service.js';

const CODE_PATTERN = /^KLIK[A-Z0-9]{8}$/;

function userById(id) {
  if (id === me.id) return me;
  return users.find((u) => u.id === id) || null;
}

function publicShape(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    publicCode: user.publicCode,
    online: Boolean(user.online),
    mutual: user.mutual || 0,
    status: user.status || '',
    friendSince: user.friendSince || null,
  };
}

function liveShape(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    publicCode: row.public_code,
    online: false,
    mutual: 0,
    status: row.status || '',
    friendSince: null,
  };
}

async function requireUid() {
  const uid = await currentUserId();
  if (!uid) throw new ServiceError('Sesi berakhir. Silakan masuk kembali.', 'UNAUTHENTICATED');
  return uid;
}

/** Ubah error PostgREST/RPC menjadi ServiceError berbahasa Indonesia. */
function mapDbError(error, fallback) {
  const message = error?.message || '';
  return new ServiceError(message || fallback, 'DB_ERROR');
}

/* ========================= Mode demo ( Milestone 1 ) ========================= */

async function demoListFriends({ state }) {
  const data = () => friendIds
    .map(userById)
    .filter(Boolean)
    .map(publicShape)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return respond(data, { state });
}

async function demoListIncoming({ state }) {
  const data = () => incomingRequests
    .map((r) => ({ ...r, user: publicShape(userById(r.from)) }))
    .filter((r) => r.user);
  return respond(data, { state, delay: 280 });
}

async function demoListOutgoing({ state }) {
  const data = () => outgoingRequests
    .map((r) => ({ ...r, user: publicShape(userById(r.to)) }))
    .filter((r) => r.user);
  return respond(data, { state, delay: 280 });
}

/* ========================= Mode live ( Supabase ) ========================= */

async function fetchProfilesByIds(sb, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await sb.from('profiles').select('*').in('id', ids);
  if (error) throw mapDbError(error, 'Gagal memuat data teman.');
  return new Map((data || []).map((row) => [row.id, row]));
}

async function liveListFriends() {
  const sb = getSupabase();
  const uid = await requireUid();
  const { data, error } = await sb.from('friendships').select('user_id_1, user_id_2, created_at');
  if (error) throw mapDbError(error, 'Gagal memuat daftar teman.');
  const sinceByUser = new Map();
  for (const f of data || []) {
    const other = f.user_id_1 === uid ? f.user_id_2 : f.user_id_1;
    sinceByUser.set(other, f.created_at);
  }
  const ids = [...sinceByUser.keys()];
  const profiles = await fetchProfilesByIds(sb, ids);
  return ids
    .map((id) => profiles.get(id))
    .filter(Boolean)
    .map((row) => ({
      ...liveShape(row),
      friendSince: sinceByUser.get(row.id) ? new Date(sinceByUser.get(row.id)) : null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function liveListRequests({ direction }) {
  const sb = getSupabase();
  const uid = await requireUid();
  const field = direction === 'incoming' ? 'receiver_id' : 'sender_id';
  const other = direction === 'incoming' ? 'sender_id' : 'receiver_id';
  const { data, error } = await sb
    .from('friend_requests')
    .select(`id, created_at, ${other}`)
    .eq(field, uid)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw mapDbError(error, 'Gagal memuat permintaan.');
  const profiles = await fetchProfilesByIds(sb, (data || []).map((r) => r[other]));
  return (data || [])
    .map((r) => {
      const profile = profiles.get(r[other]);
      if (!profile) return null;
      return {
        id: r.id,
        at: new Date(r.created_at),
        user: liveShape(profile),
      };
    })
    .filter(Boolean);
}

/* ============================== Ekspor publik ============================== */

export async function listFriends({ state = 'ok' } = {}) {
  if (state !== 'ok' || !isLive()) return demoListFriends({ state });
  return liveListFriends();
}

export async function listIncoming({ state = 'ok' } = {}) {
  if (state !== 'ok' || !isLive()) return demoListIncoming({ state });
  return liveListRequests({ direction: 'incoming' });
}

export async function listOutgoing({ state = 'ok' } = {}) {
  if (state !== 'ok' || !isLive()) return demoListOutgoing({ state });
  return liveListRequests({ direction: 'outgoing' });
}

/**
 * Cari akun berdasarkan kode publik.
 * Kode publik HANYA untuk identifikasi/penambahan teman - bukan kredensial login.
 */
export async function findByCode(rawCode) {
  const code = normalizeAccountCode(rawCode);
  if (!CODE_PATTERN.test(code)) {
    throw new ServiceError('Format kode akun tidak valid. Contoh: KLIK-7Q2M-9X4D.', 'INVALID_FORMAT');
  }

  if (!isLive()) {
    await respond(null, { delay: 450 });
    if (code === normalizeAccountCode(me.publicCode)) {
      throw new ServiceError('Kamu tidak bisa menambahkan diri sendiri.', 'SELF_ADD');
    }
    const user = users.find((u) => normalizeAccountCode(u.publicCode) === code);
    if (!user) throw new ServiceError('Kode akun tidak ditemukan.', 'NOT_FOUND');
    if (friendIds.includes(user.id)) {
      throw new ServiceError('Orang ini sudah ada di daftar temanmu.', 'ALREADY_FRIEND');
    }
    if (outgoingRequests.some((r) => r.to === user.id)) {
      throw new ServiceError('Permintaan pertemanan sudah dikirim sebelumnya.', 'DUPLICATE');
    }
    if (incomingRequests.some((r) => r.from === user.id)) {
      throw new ServiceError('Orang ini sudah mengirimmu permintaan. Buka tab Permintaan Masuk.', 'REVERSE_EXISTS');
    }
    return publicShape(user);
  }

  const sb = getSupabase();
  const uid = await requireUid();

  // Pencarian kode sendiri harus tertangkap sebelum RPC (RPC mengecualikan diri sendiri)
  const { data: own } = await sb.from('profiles').select('public_code').eq('id', uid).maybeSingle();
  if (own && normalizeAccountCode(own.public_code) === code) {
    throw new ServiceError('Kamu tidak bisa menambahkan diri sendiri.', 'SELF_ADD');
  }

  const { data, error } = await sb.rpc('find_profile_by_code', { p_code: formatAccountCode(code) });
  if (error) throw mapDbError(error, 'Gagal mencari akun.');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ServiceError('Kode akun tidak ditemukan.', 'NOT_FOUND');

  const { data: friendships, error: fErr } = await sb.from('friendships').select('user_id_1, user_id_2');
  if (fErr) throw mapDbError(fErr, 'Gagal memeriksa pertemanan.');
  const isFriend = (friendships || []).some(
    (f) => (f.user_id_1 === uid && f.user_id_2 === row.id) || (f.user_id_2 === uid && f.user_id_1 === row.id),
  );
  if (isFriend) throw new ServiceError('Orang ini sudah ada di daftar temanmu.', 'ALREADY_FRIEND');

  const { data: outgoing } = await sb
    .from('friend_requests')
    .select('id')
    .eq('sender_id', uid)
    .eq('receiver_id', row.id)
    .eq('status', 'pending');
  if ((outgoing || []).length) {
    throw new ServiceError('Permintaan pertemanan sudah dikirim sebelumnya.', 'DUPLICATE');
  }

  const { data: incoming } = await sb
    .from('friend_requests')
    .select('id')
    .eq('sender_id', row.id)
    .eq('receiver_id', uid)
    .eq('status', 'pending');
  if ((incoming || []).length) {
    throw new ServiceError('Orang ini sudah mengirimmu permintaan. Buka tab Permintaan Masuk.', 'REVERSE_EXISTS');
  }

  return liveShape(row);
}

export async function sendRequest(userId) {
  if (!isLive()) {
    if (userId === me.id) throw new ServiceError('Tidak bisa mengirim permintaan ke diri sendiri.', 'SELF_ADD');
    if (friendIds.includes(userId)) throw new ServiceError('Orang ini sudah menjadi temanmu.', 'ALREADY_FRIEND');
    if (outgoingRequests.some((r) => r.to === userId)) {
      throw new ServiceError('Permintaan sudah dikirim. Menunggu jawaban.', 'DUPLICATE');
    }
    await respond(null, { delay: 300 });
    outgoingRequests.push({ id: `fr_out_${Date.now()}`, to: userId, at: new Date() });
    return;
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('send_friend_request', { target: userId });
  if (error) throw mapDbError(error, 'Gagal mengirim permintaan pertemanan.');
}

export async function cancelRequest(requestId) {
  if (!isLive()) {
    await respond(null, { delay: 200 });
    const index = outgoingRequests.findIndex((r) => r.id === requestId);
    if (index === -1) throw new ServiceError('Permintaan tidak ditemukan.', 'NOT_FOUND');
    outgoingRequests.splice(index, 1);
    return;
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('cancel_friend_request', { request_id: requestId });
  if (error) throw mapDbError(error, 'Gagal membatalkan permintaan.');
}

export async function acceptRequest(requestId) {
  if (!isLive()) {
    await respond(null, { delay: 260 });
    const index = incomingRequests.findIndex((r) => r.id === requestId);
    if (index === -1) throw new ServiceError('Permintaan tidak ditemukan.', 'NOT_FOUND');
    const [request] = incomingRequests.splice(index, 1);
    if (!friendIds.includes(request.from)) friendIds.push(request.from);
    return;
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('respond_friend_request', { request_id: requestId, accept: true });
  if (error) throw mapDbError(error, 'Gagal menerima permintaan.');
}

export async function rejectRequest(requestId) {
  if (!isLive()) {
    await respond(null, { delay: 200 });
    const index = incomingRequests.findIndex((r) => r.id === requestId);
    if (index === -1) throw new ServiceError('Permintaan tidak ditemukan.', 'NOT_FOUND');
    incomingRequests.splice(index, 1);
    return;
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('respond_friend_request', { request_id: requestId, accept: false });
  if (error) throw mapDbError(error, 'Gagal menolak permintaan.');
}

export async function removeFriend(userId) {
  if (!isLive()) {
    await respond(null, { delay: 260 });
    const index = friendIds.indexOf(userId);
    if (index === -1) throw new ServiceError('Teman tidak ditemukan.', 'NOT_FOUND');
    friendIds.splice(index, 1);
    return;
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('remove_friend', { other: userId });
  if (error) throw mapDbError(error, 'Gagal menghapus teman.');
}

export async function getFriend(userId, { state = 'ok' } = {}) {
  if (state !== 'ok' || !isLive()) {
    const user = userById(userId);
    if (!user) throw new ServiceError('Profil tidak ditemukan.', 'NOT_FOUND');
    return respond(() => ({ ...publicShape(user), isFriend: friendIds.includes(userId) }), { state, delay: 220 });
  }
  const sb = getSupabase();
  const uid = await requireUid();
  const { data } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (!data) throw new ServiceError('Profil tidak ditemukan.', 'NOT_FOUND');
  const { data: friendships } = await sb.from('friendships').select('user_id_1, user_id_2, created_at');
  const match = (friendships || []).find(
    (f) => (f.user_id_1 === uid && f.user_id_2 === userId) || (f.user_id_2 === uid && f.user_id_1 === userId),
  );
  return {
    ...liveShape(data),
    isFriend: Boolean(match),
    friendSince: match?.created_at ? new Date(match.created_at) : null,
  };
}
