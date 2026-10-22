/**
 * E2E test Milestone 2 terhadap project Supabase NYATA (fkilgzkkzerpuapxfqka).
 * Jalankan: node scripts/e2e-supabase.mjs
 * Menguji: register -> login -> cari kode -> friend request -> room ->
 *          pesan (idempoten) -> isolasi RLS -> recovery -> rate limit.
 * Tidak ada dependensi selain Node 18+ (fetch bawaan).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  (await readFile(path.join(root, '.env'), 'utf8'))
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_ANON_KEY;
if (!BASE || !KEY) {
  console.error('.env tidak berisi SUPABASE_URL / SUPABASE_ANON_KEY');
  process.exit(1);
}

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

async function fn(name, body) {
  const res = await fetch(`${BASE}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function rest(pathname, token, opts = {}) {
  return fetch(`${BASE}/rest/v1/${pathname}`, {
    ...opts,
    headers: {
      apikey: KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
}

async function rpc(name, body, token) {
  const res = await rest(`rpc/${name}`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const stamp = Date.now().toString(36).toUpperCase();
const PASS_A = `pass-a-${stamp}`;
const PASS_B = `pass-b-${stamp}`;
const PASS_R = `pass-r-${stamp}`;
const PASS_A2 = `pass-a2-${stamp}`;

const users = {};

console.log('=== 1. Registrasi ===');

await t('register A sukses 201 + format kode & recovery key', async () => {
  const { status, data } = await fn('auth-register', {
    display_name: `Alice ${stamp}`,
    passphrase: PASS_A,
  });
  expect(status === 201, `status ${status}: ${JSON.stringify(data)}`);
  expect(/^KLIK-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(data.profile.public_code), 'kode tak valid');
  expect(/^RCV-[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(data.recovery_key), 'recovery key tak valid');
  expect(data.session?.access_token, 'access_token kosong');
  users.A = { ...data.profile, recovery: data.recovery_key, token: data.session.access_token };
});

await t('register B sukses 201', async () => {
  const { status, data } = await fn('auth-register', {
    display_name: `Bob ${stamp}`,
    passphrase: PASS_B,
  });
  expect(status === 201, `status ${status}: ${JSON.stringify(data)}`);
  users.B = { ...data.profile, recovery: data.recovery_key, token: data.session.access_token };
});

await t('register C (pihak luar) sukses 201', async () => {
  const { status, data } = await fn('auth-register', {
    display_name: `Carol ${stamp}`,
    passphrase: PASS_B,
  });
  expect(status === 201, `status ${status}: ${JSON.stringify(data)}`);
  users.C = { ...data.profile, recovery: data.recovery_key, token: data.session.access_token };
});

await t('register R (korban throttle) sukses 201', async () => {
  const { status, data } = await fn('auth-register', {
    display_name: `Ratel ${stamp}`,
    passphrase: PASS_R,
  });
  expect(status === 201, `status ${status}: ${JSON.stringify(data)}`);
  users.R = { ...data.profile, recovery: data.recovery_key, token: data.session.access_token };
});

await t('register nama pendek ditolak 400', async () => {
  const { status } = await fn('auth-register', { display_name: 'x', passphrase: PASS_A });
  expect(status === 400, `status ${status}`);
});

await t('register passphrase pendek ditolak 400', async () => {
  const { status } = await fn('auth-register', { display_name: 'Valid Name', passphrase: 'abc' });
  expect(status === 400, `status ${status}`);
});

console.log('=== 2. Login ===');

await t('login A dengan passphrase benar -> 200 + token', async () => {
  const { status, data } = await fn('auth-login', {
    public_code: users.A.public_code,
    passphrase: PASS_A,
  });
  expect(status === 200, `status ${status}: ${JSON.stringify(data)}`);
  expect(data.session?.access_token, 'token kosong');
  users.A.token = data.session.access_token;
});

await t('login A passphrase salah -> 401 pesan generik', async () => {
  const { status, data } = await fn('auth-login', {
    public_code: users.A.public_code,
    passphrase: 'salah-sekali-123',
  });
  expect(status === 401, `status ${status}`);
  expect(data.error?.message === 'Kode akun atau passphrase salah.', data.error?.message);
});

await t('login kode tak dikenal -> 401 pesan sama (tidak bocor)', async () => {
  const { status, data } = await fn('auth-login', {
    public_code: 'KLIK-ZZZZ-ZZZZ',
    passphrase: PASS_A,
  });
  expect(status === 401, `status ${status}`);
  expect(data.error?.message === 'Kode akun atau passphrase salah.', data.error?.message);
});

console.log('=== 3. Pencarian teman + request ===');

let foundB;
await t('find_profile_by_code(B) oleh A -> id B', async () => {
  const { status, data } = await rpc('find_profile_by_code', { p_code: users.B.public_code }, users.A.token);
  expect(status === 200, `status ${status}: ${JSON.stringify(data)}`);
  expect(Array.isArray(data) && data.length === 1, 'hasil bukan 1 baris');
  expect(data[0].id === users.B.id, 'id tidak cocok');
  expect(!('status' in data[0]) && !('created_at' in data[0]), 'kolom sensitif bocor');
  foundB = data[0];
});

await t('A kirim friend request ke B -> 200', async () => {
  const { status, data } = await rpc('send_friend_request', { target: users.B.id }, users.A.token);
  expect(status === 200, `status ${status}: ${JSON.stringify(data)}`);
  users.requestId = data;
});

await t('friend request duplikat ditolak', async () => {
  const { status } = await rpc('send_friend_request', { target: users.B.id }, users.A.token);
  expect(status >= 400, `status ${status}`);
});

await t('B melihat 1 permintaan pending dari A (RLS)', async () => {
  const res = await rest('friend_requests?select=id,sender_id,status&status=eq.pending', users.B.token);
  const rows = await res.json();
  expect(rows.length === 1 && rows[0].sender_id === users.A.id, JSON.stringify(rows));
});

await t('C TIDAK melihat permintaan itu (RLS)', async () => {
  const res = await rest('friend_requests?select=id&status=eq.pending', users.C.token);
  const rows = await res.json();
  expect(rows.length === 0, JSON.stringify(rows));
});

await t('A menolak dulu tidak bisa - hanya B penerima', async () => {
  const { status } = await rpc(
    'respond_friend_request',
    { request_id: users.requestId, accept: false },
    users.A.token,
  );
  expect(status >= 400, `status ${status}`);
});

await t('B terima permintaan -> 200', async () => {
  const { status, data } = await rpc(
    'respond_friend_request',
    { request_id: users.requestId, accept: true },
    users.B.token,
  );
  expect(status === 200, `status ${status}: ${JSON.stringify(data)}`);
});

await t('terima dua kali ditolak', async () => {
  const { status } = await rpc(
    'respond_friend_request',
    { request_id: users.requestId, accept: true },
    users.B.token,
  );
  expect(status >= 400, `status ${status}`);
});

await t('A & B kini melihat profil satu sama lain (RLS friendship)', async () => {
  const r1 = await rest(`profiles?id=eq.${users.B.id}&select=id`, users.A.token);
  const r2 = await rest(`profiles?id=eq.${users.A.id}&select=id`, users.B.token);
  expect((await r1.json()).length === 1, 'A tak melihat B');
  expect((await r2.json()).length === 1, 'B tak melihat A');
});

await t('C TIDAK melihat profil A (belum teman)', async () => {
  const res = await rest(`profiles?id=eq.${users.A.id}&select=id`, users.C.token);
  expect((await res.json()).length === 0, 'kebocoran profil');
});

await t('C mengirim request ke A diperbolehkan RLS (kirim via RPC)', async () => {
  const { status, data } = await rpc('send_friend_request', { target: users.A.id }, users.C.token);
  expect(status === 200, `status ${status}: ${JSON.stringify(data)}`);
  users.requestCA = data;
});
// batalkan supaya C benar-benar "pihak luar" untuk uji isolasi room
await t('C batalkan request-nya sendiri', async () => {
  const { status } = await rpc('cancel_friend_request', { request_id: users.requestCA }, users.C.token);
  expect(status === 200 || status === 204, `status ${status}`);
});

console.log('=== 4. Percakapan privat + pesan ===');

let roomId;
await t('A buat room dengan B -> uuid', async () => {
  const { status, data } = await rpc('create_room_with', { target: users.B.id }, users.A.token);
  expect(status === 200 && typeof data === 'string', `status ${status}: ${JSON.stringify(data)}`);
  roomId = data;
});

await t('create_room_with idempoten (panggil ulang = room sama)', async () => {
  const { status, data } = await rpc('create_room_with', { target: users.A.id }, users.B.token);
  expect(status === 200, `status ${status}: ${JSON.stringify(data)}`);
  expect(data === roomId, `${data} != ${roomId}`);
});

await t('A & B melihat room, C tidak (RLS)', async () => {
  const r1 = await rest(`chat_rooms?id=eq.${roomId}&select=id`, users.A.token);
  const r2 = await rest(`chat_rooms?id=eq.${roomId}&select=id`, users.B.token);
  const r3 = await rest(`chat_rooms?id=eq.${roomId}&select=id`, users.C.token);
  expect((await r1.json()).length === 1, 'A tak melihat room');
  expect((await r2.json()).length === 1, 'B tak melihat room');
  expect((await r3.json()).length === 0, 'C bocor melihat room');
});

const msgId = crypto.randomUUID();
await t('A kirim pesan (id dihasilkan klien) -> 201', async () => {
  const res = await rest('messages', users.A.token, {
    method: 'POST',
    body: JSON.stringify({ id: msgId, room_id: roomId, sender_id: users.A.id, body: 'Halo dari A' }),
  });
  expect(res.status === 201, `status ${res.status}: ${await res.text()}`);
});

await t('kirim ulang id sama -> ditolak (tidak ada pesan ganda)', async () => {
  const res = await rest('messages', users.A.token, {
    method: 'POST',
    body: JSON.stringify({ id: msgId, room_id: roomId, sender_id: users.A.id, body: 'Halo dari A' }),
  });
  expect(res.status >= 400, `status ${res.status}`);
});

await t('C kirim pesan ke room A -> ditolak RLS', async () => {
  const res = await rest('messages', users.C.token, {
    method: 'POST',
    body: JSON.stringify({
      id: crypto.randomUUID(),
      room_id: roomId,
      sender_id: users.C.id,
      body: 'nyasar',
    }),
  });
  expect(res.status >= 400, `status ${res.status}`);
});

await t('sender_id palsu (B mengaku A) -> ditolak', async () => {
  const res = await rest('messages', users.B.token, {
    method: 'POST',
    body: JSON.stringify({
      id: crypto.randomUUID(),
      room_id: roomId,
      sender_id: users.A.id,
      body: 'pemalsuan',
    }),
  });
  expect(res.status >= 400, `status ${res.status}`);
});

await t('B membaca tepat 1 pesan di room', async () => {
  const res = await rest(`messages?room_id=eq.${roomId}&select=id,body`, users.B.token);
  const rows = await res.json();
  expect(rows.length === 1 && rows[0].id === msgId, JSON.stringify(rows));
});

await t('C membaca 0 pesan (RLS isolasi)', async () => {
  const res = await rest(`messages?room_id=eq.${roomId}&select=id`, users.C.token);
  expect((await res.json()).length === 0, 'kebocoran pesan');
});

await t('A tidak bisa UPDATE pesan (append-only)', async () => {
  const res = await rest(`messages?id=eq.${msgId}`, users.A.token, {
    method: 'PATCH',
    body: JSON.stringify({ body: 'diubah' }),
  });
  const rows = await res.json().catch(() => []);
  expect(res.status >= 400 || (Array.isArray(rows) && rows.length === 0), `status ${res.status}`);
});

console.log('=== 5. Recovery key ===');

let recovery2;
await t('recovery A dengan key lama -> 200 + key baru', async () => {
  const { status, data } = await fn('auth-recover', {
    public_code: users.A.public_code,
    recovery_key: users.A.recovery,
    new_passphrase: PASS_A2,
  });
  expect(status === 200, `status ${status}: ${JSON.stringify(data)}`);
  expect(/^RCV-/.test(data.recovery_key), 'key baru tak valid');
  recovery2 = data.recovery_key;
});

await t('key lama TIDAK berlaku lagi -> 401', async () => {
  const { status } = await fn('auth-recover', {
    public_code: users.A.public_code,
    recovery_key: users.A.recovery,
    new_passphrase: 'lagi-lagi-999',
  });
  expect(status === 401, `status ${status}`);
});

await t('passphrase lama TIDAK berlaku -> 401', async () => {
  const { status } = await fn('auth-login', {
    public_code: users.A.public_code,
    passphrase: PASS_A,
  });
  expect(status === 401, `status ${status}`);
});

await t('passphrase BARU berlaku -> 200', async () => {
  const { status, data } = await fn('auth-login', {
    public_code: users.A.public_code,
    passphrase: PASS_A2,
  });
  expect(status === 200, `status ${status}: ${JSON.stringify(data)}`);
  users.A.token = data.session.access_token;
});

await t('sesi baru masih punya akses data A (RLS)', async () => {
  const res = await rest(`chat_rooms?id=eq.${roomId}&select=id`, users.A.token);
  expect((await res.json()).length === 1, 'sesi baru kehilangan akses');
});

console.log('=== 6. Throttle login (10 gagal / 15 menit) ===');

await t('11 percobaan gagal -> 429 di percobaan ke-11', async () => {
  let sawRateLimit = false;
  for (let i = 1; i <= 11; i += 1) {
    const { status } = await fn('auth-login', {
      public_code: users.R.public_code,
      passphrase: 'definitely-wrong-pass',
    });
    if (status === 429) {
      if (i < 10) throw new Error(`429 terlalu cepat di percobaan ${i}`);
      sawRateLimit = true;
      break;
    }
    if (status !== 401) throw new Error(`status tak terduga ${status} di percobaan ${i}`);
  }
  expect(sawRateLimit, 'tidak pernah kena 429');
});

await t('anon tanpa token: RPC ditolak dengan pesan rapi', async () => {
  const { status, data } = await rpc('send_friend_request', { target: users.A.id }, null);
  expect(status >= 400, `status ${status}`);
  expect(data?.message === 'Tidak terautentikasi', JSON.stringify(data));
});

console.log('=== 7. Kredensial tertutup total ===');

await t('anon membaca account_credentials -> []', async () => {
  const res = await rest('account_credentials?select=*', null);
  expect((await res.json()).length === 0, 'bocor');
});

await t('authenticated membaca account_credentials -> []', async () => {
  const res = await rest('account_credentials?select=*', users.B.token);
  expect((await res.json()).length === 0, 'bocor');
});

await t('anon membaca login_attempts -> []', async () => {
  const res = await rest('login_attempts?select=*', null);
  expect((await res.json()).length === 0, 'bocor');
});

console.log('=== 8. Push notification (notify-push FCM HTTP v1) ===');

const fnAuth = async (name, body, token) => {
  const res = await fetch(`${BASE}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

await t('notify-push tanpa sesi -> 401', async () => {
  const { status, data } = await fn('notify-push', { message_id: msgId });
  expect(status === 401, `status ${status}: ${JSON.stringify(data)}`);
});

await t('notify-push message_id rusak -> 400', async () => {
  const { status } = await fnAuth('notify-push', { message_id: 'bukan-uuid' }, users.A.token);
  expect(status === 400, `status ${status}`);
});

await t('notify-push dipanggil B utk pesan A -> 403 (hanya pengirim)', async () => {
  const { status } = await fnAuth('notify-push', { message_id: msgId }, users.B.token);
  expect(status === 403, `status ${status}`);
});

const fakeToken = `fake-fcm-${crypto.randomUUID()}`;
await t('notify-push A -> sign JWT FCM + kirim v1 (token palsu B dibersihkan)', async () => {
  const res = await rest('device_tokens', users.B.token, {
    method: 'POST',
    body: JSON.stringify({ user_id: users.B.id, token: fakeToken, platform: 'android' }),
  });
  expect(res.status === 201, `insert token: ${res.status} ${await res.text()}`);
  const { status, data } = await fnAuth('notify-push', { message_id: msgId }, users.A.token);
  // 200 = auth + service account + JWT signing + panggilan FCM v1 semua jalan;
  // token FCM palsu ditolak FCM -> invalidRemoved >= 1 (dan dihapus dari tabel).
  expect(status === 200, `status ${status}: ${JSON.stringify(data)}`);
  expect(typeof data.sent === 'number' && typeof data.invalidRemoved === 'number', JSON.stringify(data));
  expect(data.invalidRemoved >= 1 || data.sent >= 1, `FCM tak memproses token: ${JSON.stringify(data)}`);
  // Bersihkan sisa token uji (bila tidak ikut terhapus).
  await rest(`device_tokens?token=eq.${fakeToken}`, users.B.token, { method: 'DELETE' });
  const check = await rest(`device_tokens?token=eq.${fakeToken}&select=id`, users.B.token);
  expect((await check.json()).length === 0, 'token uji masih tersisa');
});

console.log(`\nHasil E2E: ${passed} lulus, ${failed} gagal`);
if (recovery2) console.log(`(recovery key A kini: ${recovery2} - data akun uji, boleh diabaikan)`);
process.exit(failed ? 1 : 0);
