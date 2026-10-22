/**
 * E2E service layer Milestone 4: chats-service live terhadap Supabase nyata.
 * Menguji: room 2 orang, kirim/baca pesan, unread, idempotensi clientId,
 * konversi dua tahap (propose/approve), grup (create/rename/role/leave),
 * dan antrean offline (outbox) di lingkungan happy-dom.
 * Jalankan: node scripts/e2e-chat.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
let skipped = 0;
async function t(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}
function skip(name, reason) {
  skipped += 1;
  console.log(`SKIP  ${name} (${reason})`);
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

/* --- Siapkan lingkungan browser-like --- */
const window = new Window({ url: 'http://localhost/' });
function setGlobal(key, value) {
  try {
    globalThis[key] = value;
    if (globalThis[key] === value) return;
  } catch { /* fallback */ }
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch { /* biarkan */ }
}
for (const key of ['window', 'localStorage', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'WebSocket', 'crypto']) {
  if (window[key] !== undefined) setGlobal(key, window[key]);
}
// Node 22 punya crypto/webcrypto global; pastikan crypto.randomUUID tersedia
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  const { webcrypto } = await import('node:crypto');
  setGlobal('crypto', webcrypto);
}

const umd = await readFile(path.join(root, 'vendor', 'supabase.js'), 'utf8');
window.eval(umd);
expect(typeof window.supabase?.createClient === 'function', 'window.supabase.createClient tidak ada');

const { BACKEND_ENABLED } = await import('../src/config.js');
expect(BACKEND_ENABLED, 'BACKEND_ENABLED false - jalankan npm run sync:env dulu');

const auth = await import('../src/services/auth-service.js');
const friends = await import('../src/services/friends-service.js');
const chats = await import('../src/services/chats-service.js');
const { isLive } = await import('../src/services/supabase.js');
expect(isLive(), 'isLive() false di lingkungan uji ini');

const stamp = Date.now().toString(36).toUpperCase();
const PASS_A = `chat-pass-a-${stamp}`;
const PASS_B = `chat-pass-b-${stamp}`;
const PASS_C = `chat-pass-c-${stamp}`;

async function loginAs(account, passphrase) {
  await auth.logout();
  return auth.loginWithPassphrase({ publicCode: account.profile.publicCode, passphrase });
}

console.log('=== Live: akun & pertemanan ===');

let accA;
let accB;
await t('setup: register A & B, berteman', async () => {
  accA = await auth.registerAccount({ displayName: `Chat Alice ${stamp}`, passphrase: PASS_A });
  accB = await auth.registerAccount({ displayName: `Chat Bob ${stamp}`, passphrase: PASS_B });
  // B request -> A accept
  await loginAs(accB, PASS_B);
  await friends.sendRequest(accA.profile.id);
  await loginAs(accA, PASS_A);
  const incoming = await friends.listIncoming();
  const req = incoming.find((r) => r.user.id === accB.profile.id);
  expect(req, 'permintaan B tidak masuk');
  await friends.acceptRequest(req.id);
});

console.log('=== Live: room 2 orang & pesan ===');

let roomId;
await t('startChatWith A -> B mengembalikan room uuid', async () => {
  roomId = await chats.startChatWith(accB.profile.id);
  expect(typeof roomId === 'string' && roomId.length > 10, `roomId: ${roomId}`);
});

await t('startChatWith idempoten: B -> A room yang sama', async () => {
  await loginAs(accB, PASS_B);
  const again = await chats.startChatWith(accA.profile.id);
  expect(again === roomId, `${again} != ${roomId}`);
});

let msg1;
await t('A kirim pesan -> muncul di listMessages', async () => {
  await loginAs(accA, PASS_A);
  msg1 = await chats.sendMessage(roomId, `Halo dari A ${stamp}`);
  expect(msg1.id && msg1.text.includes(stamp), `msg: ${JSON.stringify(msg1)}`);
  const list = await chats.listMessages(roomId);
  expect(list.some((m) => m.id === msg1.id), 'pesan A tidak ada di riwayat');
});

await t('clientId idempoten: kirim dua kali -> satu pesan', async () => {
  const clientId = crypto.randomUUID();
  const first = await chats.sendMessage(roomId, `Idem ${stamp}`, { clientId });
  const second = await chats.sendMessage(roomId, `Idem ${stamp}`, { clientId });
  expect(first.id === second.id, `${first.id} != ${second.id}`);
  const list = await chats.listMessages(roomId);
  const same = list.filter((m) => m.text === `Idem ${stamp}`);
  expect(same.length === 1, `jumlah pesan idem: ${same.length}`);
});

await t('B balas + listChats preview/unread A', async () => {
  await loginAs(accB, PASS_B);
  await chats.sendMessage(roomId, `Balasan B ${stamp}`, { replyTo: msg1.id });
  // A: unread harus > 0 karena B mengirim tanpa A mark read
  await loginAs(accA, PASS_A);
  const list = await chats.listChats();
  const row = list.find((c) => c.id === roomId);
  expect(row, 'room tidak ada di listChats A');
  expect(row.unread >= 1, `unread: ${row.unread}`);
  expect(row.preview.includes(stamp), `preview: ${row.preview}`);
});

await t('markChatRead -> unread A kembali 0', async () => {
  chats.markChatRead(chatIdSafe());
  await new Promise((r) => setTimeout(r, 400)); // fire-and-forget RPC
  const list = await chats.listChats();
  const row = list.find((c) => c.id === roomId);
  expect(row.unread === 0, `unread: ${row.unread}`);
});

function chatIdSafe() { return roomId; }

console.log('=== Live: konversi dua tahap ===');

await t('propose oleh A -> state proposed, B melihat usulan', async () => {
  const result = await chats.proposeConversion(roomId);
  expect(result.state === 'proposed', `state: ${result.state}`);
  await loginAs(accB, PASS_B);
  const chat = await chats.getChat(roomId);
  expect(chat.type === 'room', `type: ${chat.type}`);
  expect(chat.conversion?.state === 'proposed', `conv: ${chat.conversion?.state}`);
  expect(chat.conversion?.proposedBy === accA.profile.id, 'proposedBy bukan A');
});

await t('A tidak bisa approve usulannya sendiri', async () => {
  await loginAs(accA, PASS_A);
  try {
    await chats.approveConversion(roomId);
    throw new Error('seharusnya gagal');
  } catch (error) {
    expect(error.name === 'ServiceError', `tipe: ${error.name} (${error.message})`);
  }
});

await t('B approve -> room jadi private untuk kedua anggota', async () => {
  await loginAs(accB, PASS_B);
  await chats.approveConversion(roomId);
  const chatB = await chats.getChat(roomId);
  expect(chatB.type === 'private', `type B: ${chatB.type}`);
  await loginAs(accA, PASS_A);
  const chatA = await chats.getChat(roomId);
  expect(chatA.type === 'private', `type A: ${chatA.type}`);
  // riwayat tetap utuh
  const list = await chats.listMessages(roomId);
  expect(list.some((m) => m.id === msg1.id), 'riwayat hilang setelah konversi');
});

await t('propose pada private -> ditolak', async () => {
  try {
    await chats.proposeConversion(roomId);
    throw new Error('seharusnya gagal');
  } catch (error) {
    expect(error.name === 'ServiceError', `tipe: ${error.name}`);
  }
});

console.log('=== Live: grup ===');

let groupId;
await t('createGroup A [B] -> uuid, kedua anggota melihat', async () => {
  groupId = await chats.createGroup(`Tim E2E ${stamp}`, [accB.profile.id]);
  expect(typeof groupId === 'string', `groupId: ${groupId}`);
  const chatA = await chats.getChat(groupId);
  expect(chatA.type === 'group', `type: ${chatA.type}`);
  expect(chatA.memberIds.length === 2, `anggota: ${chatA.memberIds.length}`);
});

await t('listMembers A -> 2 anggota, A admin', async () => {
  const members = await chats.listMembers(groupId);
  expect(members.length === 2, `jumlah: ${members.length}`);
  const meRow = members.find((m) => m.isMe);
  expect(meRow.role === 'admin', `role: ${meRow.role}`);
  expect(chats.isGroupAdmin(groupId) === true, 'A bukan admin?');
});

await t('renameGroup oleh A -> nama berubah', async () => {
  const next = `Tim E2E Reborn ${stamp}`.slice(0, 60);
  await chats.renameGroup(groupId, next);
  const chat = await chats.getChat(groupId);
  expect(chat.title === next, `title: ${chat.title}`);
});

await t('setMemberRole B -> admin lalu kembali member', async () => {
  await chats.setMemberRole(groupId, accB.profile.id, 'admin');
  let members = await chats.listMembers(groupId);
  expect(members.find((m) => m.id === accB.profile.id).role === 'admin', 'B bukan admin');
  await chats.setMemberRole(groupId, accB.profile.id, 'member');
  members = await chats.listMembers(groupId);
  expect(members.find((m) => m.id === accB.profile.id).role === 'member', 'B bukan member');
});

await t('B (bukan admin) renameGroup -> ditolak', async () => {
  await loginAs(accB, PASS_B);
  try {
    await chats.renameGroup(groupId, `Hacker Name ${stamp}`);
    throw new Error('seharusnya gagal');
  } catch (error) {
    expect(error.name === 'ServiceError', `tipe: ${error.name}`);
  }
  await loginAs(accA, PASS_A);
});

await t('B (bukan admin) removeGroupMember A -> ditolak', async () => {
  await loginAs(accB, PASS_B);
  try {
    await chats.removeGroupMember(groupId, accA.profile.id);
    throw new Error('seharusnya gagal');
  } catch (error) {
    expect(error.name === 'ServiceError', `tipe: ${error.name} (${error.message})`);
  }
  await loginAs(accA, PASS_A);
});

let accC;
await t('setup C: register + teman A; non-anggota -> getChat ditolak', async () => {
  accC = await auth.registerAccount({ displayName: `Chat Carol ${stamp}`, passphrase: PASS_C });
  await loginAs(accC, PASS_C);
  await friends.sendRequest(accA.profile.id);
  await loginAs(accA, PASS_A);
  const incoming = await friends.listIncoming();
  const req = incoming.find((r) => r.user.id === accC.profile.id);
  expect(req, 'permintaan C tidak masuk');
  await friends.acceptRequest(req.id);
  await loginAs(accC, PASS_C);
  try {
    await chats.getChat(groupId);
    throw new Error('non-anggota masih bisa getChat');
  } catch (error) {
    expect(error.name === 'ServiceError', `tipe: ${error.name} (${error.message})`);
  }
});

await t('A addGroupMember C -> 3 anggota; C kini bisa akses', async () => {
  await loginAs(accA, PASS_A);
  await chats.addGroupMember(groupId, accC.profile.id);
  const members = await chats.listMembers(groupId);
  expect(members.length === 3, `anggota: ${members.length}`);
  await loginAs(accC, PASS_C);
  const chatC = await chats.getChat(groupId);
  expect(chatC.type === 'group', `type C: ${chatC.type}`);
});

await t('A removeGroupMember C -> C kehilangan akses', async () => {
  await loginAs(accA, PASS_A);
  await chats.removeGroupMember(groupId, accC.profile.id);
  const members = await chats.listMembers(groupId);
  expect(members.length === 2, `sisa: ${members.length}`);
  await loginAs(accC, PASS_C);
  try {
    await chats.getChat(groupId);
    throw new Error('C masih bisa akses setelah dikeluarkan');
  } catch (error) {
    expect(error.name === 'ServiceError', `tipe: ${error.name}`);
  }
});

await t('B leaveGroup -> tinggal A, lalu A leave -> room terhapus', async () => {
  await loginAs(accB, PASS_B);
  await chats.leaveGroup(groupId);
  await loginAs(accA, PASS_A);
  const members = await chats.listMembers(groupId);
  expect(members.length === 1 && members[0].isMe, `sisa: ${members.length}`);
  await chats.leaveGroup(groupId);
  try {
    await chats.getChat(groupId);
    throw new Error('room masih ada');
  } catch (error) {
    expect(error.name === 'ServiceError', `tipe: ${error.name}`);
  }
});

console.log('=== Live: outbox offline ===');

await t('sendMessage saat online -> status sent (bukan queued)', async () => {
  const saved = await chats.sendMessage(roomId, `Online msg ${stamp}`);
  expect(saved.status === 'sent', `status: ${saved.status}`);
});

await t('flushOutbox tanpa antrean -> []', async () => {
  const flushed = await chats.flushOutbox();
  expect(Array.isArray(flushed) && flushed.length === 0, `flushed: ${JSON.stringify(flushed)}`);
});

// Simulasi offline: set navigator.onLine=false bila memungkinkan
let canSimulateOffline = false;
try {
  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
  canSimulateOffline = window.navigator.onLine === false;
} catch { /* navigator.onLine readonly di env ini */ }

if (canSimulateOffline) {
  await t('sendMessage saat offline -> queued + flush setelah online', async () => {
    const offlineMsg = await chats.sendMessage(roomId, `Offline msg ${stamp}`);
    expect(offlineMsg.status === 'queued', `status: ${offlineMsg.status}`);
    // kembali online
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    const flushed = await chats.flushOutbox();
    expect(flushed.length === 1, `flushed: ${flushed.length}`);
    expect(flushed[0].text.includes('Offline msg'), `text: ${flushed[0].text}`);
    const list = await chats.listMessages(roomId);
    expect(list.some((m) => m.text.includes(`Offline msg ${stamp}`)), 'pesan offline tidak masuk riwayat');
  });
} else {
  skip('outbox offline sim', 'navigator.onLine tidak bisa di-set di happy-dom');
}

console.log('=== Live: state preview ===');

await t('listChats state=empty -> []', async () => {
  const rows = await chats.listChats({ state: 'empty' });
  expect(Array.isArray(rows) && rows.length === 0, 'preview empty gagal');
});

console.log(`\nHasil E2E chat: ${passed} lulus, ${failed} gagal, ${skipped} dilewati`);
process.exit(failed ? 1 : 0);
