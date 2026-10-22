/**
 * E2E service layer Milestone 3: menjalankan src/services/* dalam mode LIVE
 * (happy-dom + vendor/supabase.js) terhadap project Supabase nyata.
 * Berbeda dari scripts/e2e-supabase.mjs (uji mentah HTTP Edge Function),
 * skrip ini membuktikan wiring frontend (auth-service, friends-service,
 * profile-service) bekerja dari browser-like environment.
 * Jalankan: node scripts/e2e-services.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
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
for (const key of ['window', 'localStorage', 'document', 'location', 'navigator', 'HTMLElement', 'Node']) {
  if (window[key] !== undefined) setGlobal(key, window[key]);
}

// Muat UMD supabase-js persis seperti <script> di index.html
const umd = await readFile(path.join(root, 'vendor', 'supabase.js'), 'utf8');
window.eval(umd);
expect(typeof window.supabase?.createClient === 'function', 'window.supabase.createClient tidak ada setelah eval UMD');

const { BACKEND_ENABLED } = await import('../src/config.js');
expect(BACKEND_ENABLED, 'BACKEND_ENABLED false - jalankan npm run sync:env dulu');

const auth = await import('../src/services/auth-service.js');
const friends = await import('../src/services/friends-service.js');
const profile = await import('../src/services/profile-service.js');
const { isLive } = await import('../src/services/supabase.js');
expect(isLive(), 'isLive() false di lingkungan uji ini');

const stamp = Date.now().toString(36).toUpperCase();
const PASS_A = `svc-pass-a-${stamp}`;
const PASS_B = `svc-pass-b-${stamp}`;

console.log('=== Live: akun ===');

let accA;
await t('registerAccount A (live) -> kode + recovery key', async () => {
  const result = await auth.registerAccount({ displayName: `Svc Alice ${stamp}`, passphrase: PASS_A });
  expect(/^KLIK-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(result.profile.publicCode), `kode: ${result.profile.publicCode}`);
  expect(/^RCV-/.test(result.recoveryKey), 'recovery key kosong');
  accA = result;
});

await t('sesi aktif setelah register (currentSession)', async () => {
  const session = await auth.currentSession();
  expect(session?.user?.id === accA.profile.id, 'sesi tidak cocok dengan profil');
});

await t('getProfile live -> profil nyata dari Supabase', async () => {
  const p = await profile.getProfile();
  expect(p.publicCode === accA.profile.publicCode, `${p.publicCode} != ${accA.profile.publicCode}`);
  expect(p.displayName === accA.profile.displayName, 'nama tidak cocok');
});

await t('updateDisplayName live -> tersimpan di profiles', async () => {
  const newName = `Svc Alice Updated ${stamp}`.slice(0, 30);
  const p = await profile.updateDisplayName(newName);
  expect(p.displayName === newName, `hasil: ${p.displayName}`);
  const again = await profile.getProfile();
  expect(again.displayName === newName, 'perubahan tidak bertahan');
});

await t('recoveryInfo live -> key dari penyimpanan lokal perangkat', async () => {
  const info = profile.recoveryInfo();
  expect(info.recoveryKey === accA.recoveryKey, 'recovery key lokal tidak cocok');
});

let accB;
await t('registerAccount B (live)', async () => {
  accB = await auth.registerAccount({ displayName: `Svc Bob ${stamp}`, passphrase: PASS_B });
  expect(accB.profile.publicCode !== accA.profile.publicCode, 'kode sama?');
});

await t('loginWithPassphrase B (live) -> sesi baru', async () => {
  // B sudah login dari register; logout dulu untuk menguji jalur login
  await auth.logout();
  const result = await auth.loginWithPassphrase({ publicCode: accB.profile.publicCode, passphrase: PASS_B });
  expect(result.profile.publicCode === accB.profile.publicCode, 'profil login tidak cocok');
});

console.log('=== Live: pertemanan ===');

await t('findByCode A oleh B -> profil A', async () => {
  const found = await friends.findByCode(accA.profile.publicCode);
  expect(found.id === accA.profile.id, 'id tidak cocok');
  expect(found.displayName.includes('Svc Alice'), `nama: ${found.displayName}`);
});

await t('findByCode milik sendiri -> SELF_ADD', async () => {
  try {
    await friends.findByCode(accB.profile.publicCode);
    throw new Error('seharusnya gagal');
  } catch (error) {
    expect(error.code === 'SELF_ADD', `code: ${error.code} (${error.message})`);
  }
});

let requestId;
await t('sendRequest B -> A lalu listOutgoing B berisi A', async () => {
  await friends.sendRequest(accA.profile.id);
  const outgoing = await friends.listOutgoing();
  expect(outgoing.some((r) => r.user.id === accA.profile.id), 'A tidak ada di outgoing B');
  requestId = outgoing.find((r) => r.user.id === accA.profile.id).id;
});

await t('A login -> listIncoming berisi B', async () => {
  await auth.logout();
  await auth.loginWithPassphrase({ publicCode: accA.profile.publicCode, passphrase: PASS_A });
  const incoming = await friends.listIncoming();
  expect(incoming.some((r) => r.user.id === accB.profile.id), 'B tidak ada di incoming A');
});

await t('acceptRequest A <- B -> A melihat B sebagai teman', async () => {
  await friends.acceptRequest(requestId);
  const listA = await friends.listFriends();
  expect(listA.some((f) => f.id === accB.profile.id), 'B bukan teman A');
});

await t('B login -> melihat A sebagai teman', async () => {
  await auth.logout();
  await auth.loginWithPassphrase({ publicCode: accB.profile.publicCode, passphrase: PASS_B });
  const listB = await friends.listFriends();
  expect(listB.some((f) => f.id === accA.profile.id), 'A bukan teman B');
});

await t('A login kembali -> getFriend B isFriend true', async () => {
  await auth.logout();
  await auth.loginWithPassphrase({ publicCode: accA.profile.publicCode, passphrase: PASS_A });
  const f = await friends.getFriend(accB.profile.id);
  expect(f.isFriend === true, 'isFriend false');
  expect(f.publicCode === accB.profile.publicCode, 'kode tidak cocok');
});

await t('removeFriend oleh A -> B hilang dari daftar teman A', async () => {
  await friends.removeFriend(accB.profile.id);
  const listA = await friends.listFriends();
  expect(!listA.some((f) => f.id === accB.profile.id), 'B masih ada di daftar A');
});

console.log('=== Live: sesi & preview ===');

await t('logout live -> currentSession null', async () => {
  await auth.logout();
  const session = await auth.currentSession();
  expect(session === null || session?.user == null, 'sesi masih ada');
});

await t('state preview ?state=empty tetap berfungsi di live', async () => {
  const rows = await friends.listFriends({ state: 'empty' });
  expect(Array.isArray(rows) && rows.length === 0, 'preview empty gagal');
});

await t('tanpa sesi, service melempar ServiceError (bukan crash)', async () => {
  try {
    await friends.listFriends();
    throw new Error('seharusnya gagal tanpa sesi');
  } catch (error) {
    expect(error.name === 'ServiceError', `tipe: ${error.name}`);
  }
});

console.log(`\nHasil E2E services: ${passed} lulus, ${failed} gagal`);
process.exit(failed ? 1 : 0);
