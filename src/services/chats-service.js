/**
 * Service percakapan (Milestone 4).
 * Mode live : tabel chat_rooms/chat_room_members/messages + RPC
 *             (mark_room_read, propose/approve/cancel_conversion,
 *              create_room_with, create_group_room, add/remove/role,
 *              leave_room, rename_group) + Realtime + antrean offline.
 * Mode demo : data dummy Milestone 1 (dipakai uji otomatis Node).
 * Kontrak fungsi publik dijaga agar halaman tidak perlu berubah bentuk.
 */
import {
  chats, groupRoles, me, messagesByChat, users,
} from '../data/dummy.js';
import { respond, requireText, ServiceError } from './_fake.js';
import { localId } from '../utils/id.js';
import { isLive, getSupabase } from './supabase.js';
import { currentUserId } from './auth-service.js';
import { isOnline } from './presence-service.js';
import * as outbox from '../utils/offline-queue.js';
import { clearNotificationsForRoom } from './foreground-notifications.js';

/* ============================== Util ============================== */

function userById(id) {
  if (id === me.id) return me;
  return users.find((u) => u.id === id) || null;
}

function mapDbError(error, fallback) {
  const message = error?.message || '';
  return new ServiceError(message || fallback, 'DB_ERROR');
}

async function requireUid() {
  const uid = await currentUserId();
  if (!uid) throw new ServiceError('Sesi berakhir. Silakan masuk kembali.', 'UNAUTHENTICATED');
  return uid;
}

function otherMember(chat) {
  const otherId = chat.memberIds.find((id) => id !== me.id);
  return userById(otherId) || { id: otherId, displayName: 'Tidak dikenal' };
}

function chatTitle(chat) {
  if (chat.type === 'group') return chat.name || 'Grup tanpa nama';
  return otherMember(chat).displayName;
}

function chatSubtitle(chat) {
  if (chat.type === 'group') {
    const n = chat.memberIds.length;
    return `${n} anggota`;
  }
  const other = otherMember(chat);
  if (other.online) return 'Online';
  if (other.lastSeenAt) {
    const diffMenit = Math.round((Date.now() - new Date(other.lastSeenAt)) / 60000);
    if (diffMenit < 60) return `Terlihat ${diffMenit} menit lalu`;
    return 'Terlihat belum lama';
  }
  return 'Offline';
}

/**
 * Subtitle presence utk chat 1:1 (live): 'Online' / 'Offline'.
 * Dipakai liveListChats/liveGetChat & halaman saat presence berubah.
 */
export function peerSubtitle(peerId) {
  if (!peerId) return '';
  return isOnline(peerId) ? 'Online' : 'Offline';
}

/**
 * Perbarui subtitle direct-chat dari presence terkini (live only).
 * Demo dikembalikan apa adanya (subtitle dummy sudah memuat status online).
 */
export function withFreshPresence(list) {
  if (!isLive() || !Array.isArray(list)) return list;
  return list.map((chat) => {
    if (chat.type === 'group' || !chat.peerId) return chat;
    const subtitle = peerSubtitle(chat.peerId);
    return subtitle === chat.subtitle ? chat : { ...chat, subtitle };
  });
}

function lastMessageOf(chatId) {
  const list = messagesByChat[chatId] || [];
  return list.length ? list[list.length - 1] : null;
}

function previewText(message, chat) {
  if (!message) return 'Belum ada pesan';
  const prefix = message.senderId === me.id ? 'Kamu: ' : '';
  if (chat.type === 'group' && message.senderId !== me.id) {
    const sender = userById(message.senderId);
    return `${sender ? sender.displayName.split(' ')[0] : 'Anggota'}: ${message.text}`;
  }
  return prefix + message.text;
}

/* ========================= Mode demo ( Milestone 1 ) ========================= */

async function demoListChats({ state }) {
  const data = () => chats
    .map((chat) => {
      const last = lastMessageOf(chat.id);
      return {
        id: chat.id,
        type: chat.type,
        title: chatTitle(chat),
        subtitle: chatSubtitle(chat),
        preview: previewText(last, chat),
        lastAt: last ? last.at : chat.createdAt,
        unread: chat.unread,
        memberIds: [...chat.memberIds],
        peerId: chat.type === 'group' ? null : otherMember(chat).id,
      };
    })
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  return respond(data, { state });
}

async function demoGetChat(chatId, { state }) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) throw new ServiceError('Percakapan tidak ditemukan.', 'NOT_FOUND');
  return respond(() => ({
    id: chat.id,
    type: chat.type,
    title: chatTitle(chat),
    subtitle: chatSubtitle(chat),
    memberIds: [...chat.memberIds],
    unread: chat.unread,
    roles: groupRoles[chat.id] ? { ...groupRoles[chat.id] } : null,
    createdBy: chat.createdBy || null,
    createdAt: chat.createdAt,
    peerId: chat.type === 'group' ? null : otherMember(chat).id,
    members: null,
    conversion: null,
  }), { state });
}

async function demoListMessages(chatId, { state }) {
  if (!chats.find((c) => c.id === chatId)) {
    throw new ServiceError('Percakapan tidak ditemukan.', 'NOT_FOUND');
  }
  const data = () => [...(messagesByChat[chatId] || [])];
  return respond(data, { state, delay: 260 });
}

async function demoSendMessage(chatId, text, { replyTo = null } = {}) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) throw new ServiceError('Percakapan tidak ditemukan.', 'NOT_FOUND');
  if (!chat.memberIds.includes(me.id)) {
    throw new ServiceError('Kamu bukan anggota percakapan ini.', 'NOT_MEMBER');
  }
  const clean = requireText(text, 'Pesan', { min: 1, max: 4000 });
  await respond(null, { delay: 180 });
  const message = {
    id: localId('m'),
    senderId: me.id,
    text: clean,
    at: new Date(),
    status: 'sent',
    replyTo,
  };
  messagesByChat[chatId] = messagesByChat[chatId] || [];
  messagesByChat[chatId].push(message);
  return message;
}

function demoRequireGroupMember(chatId) {
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) throw new ServiceError('Percakapan tidak ditemukan.', 'NOT_FOUND');
  if (chat.type !== 'group') throw new ServiceError('Operasi ini hanya berlaku untuk grup.', 'NOT_GROUP');
  if (!chat.memberIds.includes(me.id)) {
    throw new ServiceError('Kamu bukan anggota grup ini.', 'NOT_MEMBER');
  }
  return chat;
}

/* ========================= Mode live ( Supabase ) ========================= */

/**
 * Map baris `list_my_chats` ke bentuk daftar percakapan halaman.
 * Judul privat/room diambil dari profil peer; preview dari pesan terakhir.
 */
async function liveListChats() {
  const sb = getSupabase();
  const uid = await requireUid();
  const { data, error } = await sb.rpc('list_my_chats');
  if (error) throw mapDbError(error, 'Gagal memuat daftar percakapan.');

  const allMemberIds = [...new Set((data || []).flatMap((r) => r.member_ids || []))];
  const profiles = await fetchProfiles(sb, allMemberIds);
  const myName = profiles.get(uid)?.display_name || 'Kamu';

  return (data || []).map((row) => {
    const others = (row.member_ids || []).filter((id) => id !== uid);
    const peerId = row.room_type === 'group' ? null : others[0] || null;
    const peer = peerId ? profiles.get(peerId) : null;
    const title = row.room_type === 'group'
      ? (row.room_name || 'Grup tanpa nama')
      : (peer?.display_name || 'Tidak dikenal');
    const subtitle = row.room_type === 'group'
      ? `${(row.member_ids || []).length} anggota`
      : peerSubtitle(peerId);

    let preview = 'Belum ada pesan';
    if (row.last_message_body) {
      const senderName = row.last_message_sender === uid
        ? 'Kamu'
        : (row.last_message_sender
          ? (profiles.get(row.last_message_sender)?.display_name || 'Anggota').split(' ')[0]
          : 'Anggota');
      if (row.room_type === 'group') {
        preview = `${senderName}: ${row.last_message_body}`;
      } else if (row.last_message_sender === uid) {
        preview = `Kamu: ${row.last_message_body}`;
      } else {
        preview = row.last_message_body;
      }
    }

    return {
      id: row.room_id,
      type: row.room_type,
      title,
      subtitle,
      preview,
      lastAt: row.last_message_at || row.room_created_at,
      unread: Number(row.unread_count || 0),
      memberIds: row.member_ids || [],
      peerId,
    };
  });
}

async function fetchProfiles(sb, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await sb.from('profiles').select('id, display_name, public_code').in('id', ids);
  if (error) throw mapDbError(error, 'Gagal memuat data anggota.');
  return new Map((data || []).map((row) => [row.id, row]));
}

function mapMessage(row) {
  return {
    id: row.id,
    senderId: row.sender_id,
    text: row.body,
    at: new Date(row.created_at),
    status: 'sent',
    replyTo: row.reply_to || null,
  };
}

async function liveGetChat(chatId) {
  const sb = getSupabase();
  const uid = await requireUid();

  const { data: room, error: roomErr } = await sb
    .from('chat_rooms').select('*').eq('id', chatId).maybeSingle();
  if (roomErr) throw mapDbError(roomErr, 'Gagal memuat percakapan.');
  if (!room) throw new ServiceError('Percakapan tidak ditemukan.', 'NOT_FOUND');

  const { data: members, error: memErr } = await sb
    .from('chat_room_members').select('user_id, role, joined_at').eq('room_id', chatId);
  if (memErr) throw mapDbError(memErr, 'Gagal memuat anggota.');
  const memberRows = members || [];
  if (!memberRows.some((m) => m.user_id === uid)) {
    throw new ServiceError('Kamu bukan anggota percakapan ini.', 'NOT_MEMBER');
  }

  const profiles = await fetchProfiles(sb, memberRows.map((m) => m.user_id));
  const memberList = memberRows.map((m) => {
    const p = profiles.get(m.user_id);
    return {
      id: m.user_id,
      role: m.role,
      displayName: p?.display_name || 'Anggota',
      publicCode: p?.public_code || '',
    };
  });

  const my = memberRows.find((m) => m.user_id === uid);
  const { count } = await sb
    .from('messages').select('id', { count: 'exact', head: true })
    .eq('room_id', chatId)
    .gt('created_at', my?.last_read_at || 0)
    .neq('sender_id', uid);

  const others = memberList.filter((m) => m.id !== uid);
  const peerId = room.type === 'group' ? null : (others[0]?.id || null);
  const peer = peerId ? memberList.find((m) => m.id === peerId) : null;
  const title = room.type === 'group' ? (room.name || 'Grup tanpa nama') : (peer?.displayName || 'Tidak dikenal');
  const subtitle = room.type === 'group' ? `${memberList.length} anggota` : peerSubtitle(peerId);

  const rolesMap = Object.fromEntries(memberList.map((m) => [m.id, m.role]));
  chatMeta.set(chatId, { roles: rolesMap, myUid: uid });

  return {
    id: room.id,
    type: room.type,
    title,
    subtitle,
    memberIds: memberList.map((m) => m.id),
    unread: Number(count || 0),
    roles: room.type === 'group' ? { ...rolesMap } : null,
    createdBy: room.created_by || null,
    createdAt: room.created_at,
    peerId,
    members: memberList,
    conversion: {
      state: room.conversion_state || 'none',
      proposedBy: room.conversion_proposed_by || null,
      proposedAt: room.conversion_proposed_at || null,
    },
  };
}

async function liveListMessages(chatId, { before = null } = {}) {
  const sb = getSupabase();
  await requireUid();
  let query = sb
    .from('messages').select('*')
    .eq('room_id', chatId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw mapDbError(error, 'Gagal memuat pesan.');
  return (data || []).reverse().map(mapMessage);
}

/**
 * Kirim notifikasi push (FCM) ke anggota lain via Edge Function notify-push.
 * Fire-and-forget: kegagalan mengirim notifikasi TIDAK menggagalkan pesan.
 */
function notifyPush(messageId) {
  try {
    getSupabase().functions.invoke('notify-push', { body: { message_id: messageId } })
      .then(({ error }) => { if (error) console.warn('notify-push:', error.message); })
      .catch(() => { /* abaikan */ });
  } catch { /* abaikan */ }
}

/**
 * Insert pesan dengan id client-generated (idempoten).
 * Jika offline / gagal jaringan -> masuk antrean outbox, kembalikan status 'queued'.
 */
async function insertMessage(roomId, text, { replyTo = null, id = null, allowQueue = true } = {}) {
  const sb = getSupabase();
  const uid = await requireUid();
  const clean = requireText(text, 'Pesan', { min: 1, max: 4000 });
  const messageId = id || crypto.randomUUID();

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline && allowQueue) {
    await outbox.enqueue({ id: messageId, roomId, text: clean, replyTo, at: new Date().toISOString() });
    return { id: messageId, senderId: uid, text: clean, at: new Date(), status: 'queued', replyTo };
  }

  const { data, error } = await sb
    .from('messages')
    .insert({ id: messageId, room_id: roomId, sender_id: uid, body: clean, reply_to: replyTo })
    .select()
    .single();

  if (error) {
    // Idempoten: id sama sudah ada -> kembalikan baris yang sudah tersimpan.
    if (error.code === '23505' || /duplicate key/i.test(error.message || '')) {
      const { data: existing } = await sb.from('messages').select('*').eq('id', messageId).maybeSingle();
      if (existing) return mapMessage(existing);
    }
    if (allowQueue && (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      await outbox.enqueue({ id: messageId, roomId, text: clean, replyTo, at: new Date().toISOString() });
      return { id: messageId, senderId: uid, text: clean, at: new Date(), status: 'queued', replyTo };
    }
    throw mapDbError(error, 'Pesan gagal terkirim.');
  }
  notifyPush(messageId);
  return mapMessage(data);
}

/** Kirim ulang pesan tertunda di outbox (dipanggil saat koneksi pulih). */
export async function flushOutbox() {
  if (!isLive()) return [];
  const items = await outbox.listQueued();
  const sent = [];
  for (const item of items) {
    try {
      const saved = await insertMessage(item.roomId, item.text, {
        replyTo: item.replyTo, id: item.id, allowQueue: false,
      });
      await outbox.remove(item.id);
      sent.push(saved);
    } catch (error) {
      // Jaringan masih mati: berhenti, sisanya antre untuk flush berikutnya.
      if (error instanceof ServiceError && error.code === 'UNAUTHENTICATED') {
        await outbox.remove(item.id);
        continue;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
      // Error lain (mis. room dihapus): buang agar tidak macet selamanya.
      await outbox.remove(item.id);
    }
  }
  return sent;
}

/* ===================== Cache role (untuk myRole sync) ===================== */

const chatMeta = new Map(); // chatId -> { roles: {uid: role}, myUid }

/* ============================== Ekspor publik ============================== */

export { userById };

export async function listChats({ state = 'ok' } = {}) {
  if (state !== 'ok' || !isLive()) return demoListChats({ state });
  return liveListChats();
}

export async function getChat(chatId, { state = 'ok' } = {}) {
  if (state !== 'ok' || !isLive()) return demoGetChat(chatId, { state });
  return liveGetChat(chatId);
}

export async function listMessages(chatId, { state = 'ok', before = null } = {}) {
  if (state !== 'ok' || !isLive()) return demoListMessages(chatId, { state });
  return liveListMessages(chatId, { before });
}

export async function sendMessage(chatId, text, { replyTo = null, clientId = null } = {}) {
  if (!isLive()) return demoSendMessage(chatId, text, { replyTo });
  return insertMessage(chatId, text, { replyTo, id: clientId });
}

export function markChatRead(chatId) {
  if (!isLive()) {
    const chat = chats.find((c) => c.id === chatId);
    if (chat) chat.unread = 0;
    // Hapus notifikasi lokal meskipun mode demo
    clearNotificationsForRoom(chatId);
    return;
  }
  // Fire-and-forget: halaman memanggil sinkron tanpa await.
  getSupabase().rpc('mark_room_read', { p_room: chatId }).then(({ error }) => {
    if (error) console.warn('mark_room_read gagal:', error.message);
  }).catch(() => { /* abaikan */ });
  // Hapus notifikasi lokal yang berkaitan dengan ruangan ini
  clearNotificationsForRoom(chatId);
}

export async function listMembers(chatId, { state = 'ok' } = {}) {
  if (state !== 'ok' || !isLive()) {
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) throw new ServiceError('Percakapan tidak ditemukan.', 'NOT_FOUND');
    if (!chat.memberIds.includes(me.id)) {
      throw new ServiceError('Kamu bukan anggota percakapan ini.', 'NOT_MEMBER');
    }
    const roles = groupRoles[chatId] || {};
    const data = () => chat.memberIds.map((id) => {
      const user = userById(id) || { id, displayName: 'Anggota' };
      return {
        id: user.id,
        displayName: user.displayName,
        online: Boolean(user.online),
        role: roles[id] || 'member',
        isMe: id === me.id,
      };
    });
    return respond(data, { state, delay: 220 });
  }

  const sb = getSupabase();
  const uid = await requireUid();
  const { data: members, error } = await sb
    .from('chat_room_members').select('user_id, role').eq('room_id', chatId);
  if (error) throw mapDbError(error, 'Gagal memuat anggota.');
  const memberRows = members || [];
  if (!memberRows.some((m) => m.user_id === uid)) {
    throw new ServiceError('Kamu bukan anggota percakapan ini.', 'NOT_MEMBER');
  }
  const profiles = await fetchProfiles(sb, memberRows.map((m) => m.user_id));
  const rolesMap = Object.fromEntries(memberRows.map((m) => [m.user_id, m.role]));
  chatMeta.set(chatId, { roles: rolesMap, myUid: uid });
  return memberRows.map((m) => {
    const p = profiles.get(m.user_id);
    return {
      id: m.user_id,
      displayName: p?.display_name || 'Anggota',
      online: isOnline(m.user_id),
      // 'owner' ditampilkan sebagai admin di UI (demo punya admin saja).
      role: m.role === 'owner' ? 'admin' : m.role,
      isMe: m.user_id === uid,
    };
  });
}

/** Role saya di room (dari cache; live butuh getChat/listMembers dipanggil dulu). */
export function myRole(chatId) {
  if (!isLive()) return groupRoles[chatId]?.[me.id] || 'member';
  const meta = chatMeta.get(chatId);
  if (!meta) return 'member';
  return meta.roles?.[meta.myUid] || 'member';
}

export function isGroupAdmin(chatId) {
  const role = myRole(chatId);
  return role === 'admin' || role === 'owner';
}

export async function addGroupMember(chatId, userId) {
  if (!isLive()) {
    const chat = demoRequireGroupMember(chatId);
    if (chat.memberIds.includes(userId)) throw new ServiceError('Orang ini sudah menjadi anggota.', 'ALREADY_MEMBER');
    await respond(null, { delay: 280 });
    chat.memberIds.push(userId);
    groupRoles[chatId] = groupRoles[chatId] || {};
    groupRoles[chatId][userId] = 'member';
    return;
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('add_room_members', { p_room: chatId, p_members: [userId] });
  if (error) throw mapDbError(error, 'Gagal menambah anggota.');
}

export async function removeGroupMember(chatId, userId) {
  if (!isLive()) {
    const chat = demoRequireGroupMember(chatId);
    if (!isGroupAdmin(chatId)) throw new ServiceError('Hanya admin yang dapat mengeluarkan anggota.', 'FORBIDDEN');
    if (userId === me.id) throw new ServiceError('Gunakan "Keluar dari grup" untuk diri sendiri.', 'INVALID_TARGET');
    if (!chat.memberIds.includes(userId)) throw new ServiceError('Anggota tidak ditemukan.', 'NOT_FOUND');
    await respond(null, { delay: 260 });
    chat.memberIds = chat.memberIds.filter((id) => id !== userId);
    delete groupRoles[chatId]?.[userId];
    return;
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('remove_room_member', { p_room: chatId, p_target: userId });
  if (error) throw mapDbError(error, 'Gagal mengeluarkan anggota.');
}

export async function setMemberRole(chatId, userId, role) {
  if (!isLive()) {
    const chat = demoRequireGroupMember(chatId);
    if (!isGroupAdmin(chatId)) throw new ServiceError('Hanya admin yang dapat mengubah role.', 'FORBIDDEN');
    if (!chat.memberIds.includes(userId)) throw new ServiceError('Anggota tidak ditemukan.', 'NOT_FOUND');
    if (!['admin', 'member'].includes(role)) throw new ServiceError('Role tidak valid.', 'VALIDATION');
    await respond(null, { delay: 220 });
    groupRoles[chatId] = groupRoles[chatId] || {};
    groupRoles[chatId][userId] = role;
    return;
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('set_room_member_role', { p_room: chatId, p_target: userId, p_role: role });
  if (error) throw mapDbError(error, 'Gagal mengubah role anggota.');
}

export async function renameGroup(chatId, rawName) {
  const name = requireText(rawName, 'Nama grup', { min: 3, max: 60 });
  if (!isLive()) {
    const chat = demoRequireGroupMember(chatId);
    if (!isGroupAdmin(chatId)) throw new ServiceError('Hanya admin yang dapat mengubah nama grup.', 'FORBIDDEN');
    await respond(null, { delay: 240 });
    chat.name = name;
    return { id: chatId, name };
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('rename_group', { p_room: chatId, p_name: name });
  if (error) throw mapDbError(error, 'Gagal mengubah nama grup.');
  return { id: chatId, name };
}

export async function leaveGroup(chatId) {
  if (!isLive()) {
    const chat = demoRequireGroupMember(chatId);
    await respond(null, { delay: 300 });
    chat.memberIds = chat.memberIds.filter((id) => id !== me.id);
    const roles = groupRoles[chatId] || {};
    const wasAdmin = roles[me.id] === 'admin';
    delete roles[me.id];
    if (wasAdmin) {
      const next = chat.memberIds[0];
      if (next) roles[next] = 'admin';
    }
    if (chat.memberIds.length === 0) {
      chats.splice(chats.indexOf(chat), 1);
      delete messagesByChat[chatId];
      delete groupRoles[chatId];
    }
    return;
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('leave_room', { p_room: chatId });
  if (error) throw mapDbError(error, 'Gagal keluar dari grup.');
}

/* ===================== Konversi room -> private (2 tahap) ===================== */

/**
 * Tahap 1: usulkan konversi (hanya anggota room dengan tepat 2 orang).
 * Setelah ini, state room = 'proposed'; anggota lain harus approve.
 */
export async function proposeConversion(chatId) {
  if (!isLive()) {
    // Demo: simulasi persetujuan otomatis (Milestone 1).
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) throw new ServiceError('Percakapan tidak ditemukan.', 'NOT_FOUND');
    if (chat.type === 'private') throw new ServiceError('Percakapan ini sudah bersifat privat.', 'ALREADY_PRIVATE');
    if (chat.type === 'group') {
      throw new ServiceError('Grup tidak dapat diubah menjadi chat privat.', 'GROUP_REJECTED');
    }
    if (chat.memberIds.length !== 2) {
      throw new ServiceError('Konversi hanya bisa dilakukan pada room dengan 2 anggota.', 'TOO_MANY_MEMBERS');
    }
    await respond(null, { delay: 900 });
    chat.type = 'private';
    return { id: chat.id, type: chat.type, state: 'converted' };
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('propose_conversion', { p_room: chatId });
  if (error) throw mapDbError(error, 'Gagal mengajukan konversi.');
  return { id: chatId, state: 'proposed' };
}

/** Tahap 2: anggota LAIN menyetujui konversi (atomik & idempoten di server). */
export async function approveConversion(chatId) {
  if (!isLive()) {
    const chat = chats.find((c) => c.id === chatId);
    if (chat) chat.type = 'private';
    return { id: chatId, type: 'private', state: 'converted' };
  }
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('approve_conversion', { p_room: chatId });
  if (error) throw mapDbError(error, 'Gagal menyetujui konversi.');
  return { id: chatId, state: 'converted' };
}

/** Batalkan usulan konversi (oleh pengusul; anggota lain juga bisa membatalkan). */
export async function cancelConversion(chatId) {
  if (!isLive()) return { id: chatId, state: 'none' };
  const sb = getSupabase();
  await requireUid();
  const { error } = await sb.rpc('cancel_conversion', { p_room: chatId });
  if (error) throw mapDbError(error, 'Gagal membatalkan konversi.');
  return { id: chatId, state: 'none' };
}

/**
 * Kompatibilitas mundur (halaman Milestone 1 memanggil ini sekali).
 * Live: usulkan konversi (tahap 1). Demo: langsung konversi (simulasi).
 */
export async function convertToPrivate(chatId) {
  return proposeConversion(chatId);
}

/* ============================== Percakapan baru ============================== */

export async function startChatWith(friendId) {
  if (!isLive()) {
    const friend = userById(friendId);
    if (!friend) throw new ServiceError('Teman tidak ditemukan.', 'NOT_FOUND');
    const existing = chats.find(
      (c) => c.type !== 'group' && c.memberIds.includes(friendId),
    );
    if (existing) return existing.id;
    await respond(null, { delay: 260 });
    const chat = {
      id: localId('c'),
      type: 'private',
      memberIds: [me.id, friendId],
      unread: 0,
      createdAt: new Date(),
    };
    chats.unshift(chat);
    messagesByChat[chat.id] = messagesByChat[chat.id] || [];
    return chat.id;
  }
  const sb = getSupabase();
  await requireUid();
  const { data, error } = await sb.rpc('create_room_with', { target: friendId });
  if (error) throw mapDbError(error, 'Gagal memulai percakapan.');
  return data;
}

export async function createGroup(name, memberIds) {
  const cleanName = requireText(name, 'Nama grup', { min: 3, max: 60 });
  if (!Array.isArray(memberIds) || memberIds.length < 1) {
    throw new ServiceError('Pilih minimal satu anggota untuk grup.', 'VALIDATION');
  }
  if (!isLive()) {
    await respond(null, { delay: 320 });
    const id = localId('c');
    const chat = {
      id,
      type: 'group',
      name: cleanName,
      memberIds: [me.id, ...memberIds],
      unread: 0,
      createdAt: new Date(),
      createdBy: me.id,
    };
    chats.unshift(chat);
    messagesByChat[id] = [];
    groupRoles[id] = { [me.id]: 'admin' };
    for (const memberId of memberIds) groupRoles[id][memberId] = 'member';
    return id;
  }
  const sb = getSupabase();
  await requireUid();
  const { data, error } = await sb.rpc('create_group_room', { group_name: cleanName, member_ids: memberIds });
  if (error) throw mapDbError(error, 'Gagal membuat grup.');
  return data;
}

/* ============================== Realtime ============================== */

/**
 * Backoff retry utk channel Realtime yang gagal join / putus
 * ( WebView Android sering kehilangan socket senyap setelah background ).
 */
const CHANNEL_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

/**
 * Subscribe channel Supabase Realtime dengan auto-retry.
 * - CHANNEL_ERROR / TIMED_OUT / CLOSED -> channel baru + backoff.
 * - App kembali visible / jaringan 'online' -> join ulang bila belum joined.
 * @param {() => import('@supabase/supabase-js').RealtimeChannel} createChannel
 * @returns {() => void} fungsi unsubscribe (hapus listener & channel).
 */
function subscribeResilient(createChannel) {
  if (!isLive()) return () => {};
  const sb = getSupabase();
  let channel = null;
  let attempt = 0;
  let timer = 0;
  let closed = false;

  function detach() {
    if (!channel) return;
    try { sb.removeChannel(channel); } catch { /* abaikan */ }
    channel = null;
  }

  function schedule() {
    if (closed || timer) return;
    const delay = CHANNEL_BACKOFF_MS[Math.min(attempt, CHANNEL_BACKOFF_MS.length - 1)];
    attempt += 1;
    timer = setTimeout(() => {
      timer = 0;
      if (closed) return;
      detach();
      attach();
    }, delay);
  }

  function attach() {
    channel = createChannel();
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        attempt = 0;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        schedule();
      }
    });
  }

  function onWake() {
    if (closed) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (channel && channel.state === 'joined') return;
    if (timer) { clearTimeout(timer); timer = 0; }
    attempt = 0;
    detach();
    attach();
  }

  attach();
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onWake);
  }

  return () => {
    closed = true;
    if (timer) { clearTimeout(timer); timer = 0; }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onWake);
    }
    detach();
  };
}

let feedSeq = 0;

/**
 * Subscribe ke pesan & update room (konversi) via Supabase Realtime.
 * RLS menjamin caller hanya menerima event room yang ia anggota.
 * Auto-retry bila channel gagal join (lihat subscribeResilient).
 * Mode demo: no-op.
 * @returns {() => void} fungsi unsubscribe.
 */
export function subscribeRoom(chatId, { onMessage, onRoomChange } = {}) {
  if (!isLive()) return () => {};
  return subscribeResilient(() => getSupabase()
    .channel(`klik-room-${chatId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${chatId}` },
      (payload) => { if (payload.new) onMessage?.(mapMessage(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'chat_rooms', filter: `id=eq.${chatId}` },
      (payload) => { if (payload.new) onRoomChange?.(payload.new); },
    ));
}

/**
 * Subscribe ke SEMUA pesan baru milik user (tanpa filter; RLS membatasi
 * ke room keanggotaan) -> daftar chat di home / kolom kiri bisa refresh
 * tanpa keluar dari room yang sedang terbuka.
 * Mode demo: no-op. @returns {() => void} fungsi unsubscribe.
 */
export function subscribeMessageFeed(onMessage) {
  if (!isLive()) return () => {};
  feedSeq += 1;
  const topic = `klik-feed-${feedSeq}`;
  return subscribeResilient(() => getSupabase()
    .channel(topic)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => { if (payload.new) onMessage?.(mapMessage(payload.new)); },
    ));
}
