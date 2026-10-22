/**
 * Smoke test render halaman dengan DOM headless (happy-dom).
 * Memverifikasi: router, shell navigasi, semua halaman utama,
 * state loading/error/empty, dan pengiriman pesan.
 * Jalankan: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

/* --- Siapkan DOM global sebelum modul aplikasi diimpor --- */
const window = new Window({ url: 'http://localhost:5173/' });
function setGlobal(key, value) {
  try {
    globalThis[key] = value;
    if (globalThis[key] === value) return;
  } catch { /* jatuh ke defineProperty */ }
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch {
    /* dibiarkan - ada global bawaan Node */
  }
}

for (const key of [
  'document', 'location', 'navigator', 'Node', 'Element', 'HTMLElement',
  'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'URLSearchParams',
  'DOMParser', 'MutationObserver', 'getComputedStyle',
]) {
  if (window[key] !== undefined) setGlobal(key, window[key]);
}
setGlobal('window', window);
window.scrollTo = () => {};

document.body.innerHTML = `
  <div id="app"></div>
  <div id="toast-host"></div>
  <div id="modal-root"></div>`;

await import('../src/main.js');
const { renderRoute, navigate } = await import('../src/router/router.js');
const { me } = await import('../src/data/dummy.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function goto(hash, { settle = 900 } = {}) {
  window.location.hash = hash;
  renderRoute();
  await wait(settle);
}

test('welcome: menampilkan brand, tombol buat akun & masuk', async () => {
  await goto('#/welcome');
  assert.match($('.text-display').textContent, /KLIK/);
  const hrefs = $$('a.btn').map((a) => a.getAttribute('href'));
  assert.ok(hrefs.includes('#/create-account'), 'tombol buat akun ada');
  assert.ok(hrefs.includes('#/login'), 'tombol masuk ada');
  assert.match(document.body.textContent, /Tanpa email/i);
});

test('create-account: form validasi -> hasil identitas + kode + recovery key', async () => {
  await goto('#/create-account');
  const form = $('form');
  assert.ok(form, 'form tersedia');

  // Nama terlalu pendek -> error tampil
  $('#display-name').value = 'A';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(50);
  assert.ok(!$('.field__error.hidden'), 'error validasi tampil');
  assert.match($('.field__error').textContent, /minimal 2 karakter/);

  // Nama valid, passphrase belum diisi -> error passphrase
  $('#display-name').value = 'Alya';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(50);
  assert.match($('.field__error').textContent, /Passphrase minimal 8 karakter/);

  // Passphrase terisi tapi konfirmasi beda -> error konfirmasi
  $('#passphrase').value = 'kata-sandi-rahasia';
  $('#passphrase-confirm').value = 'kata-sandi-salah';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(50);
  assert.match($('.field__error').textContent, /tidak sama/);

  // Lengkap -> hasil
  $('#passphrase-confirm').value = 'kata-sandi-rahasia';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(1300);
  assert.match(document.body.textContent, /Akun Dibuat/);
  assert.match($('#public-code').textContent, /^KLIK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.match($('#recovery-key').textContent, /^RCV-/);
  assert.ok($('.qr-placeholder'), 'preview QR dirender');
});

test('login: validasi format kode dan panjang passphrase', async () => {
  await goto('#/login');
  const form = $('form');
  $('#login-code').value = 'salah-banget';
  $('#login-pass').value = 'rahasia123';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(50);
  assert.match($('.field__error').textContent, /Format kode akun tidak valid/);

  $('#login-code').value = 'KLIK-7Q2M-9X4D';
  $('#login-pass').value = 'pendek';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(50);
  assert.match($('.field__error').textContent, /minimal 8 karakter/);

  // Berhasil -> berpindah ke daftar chat
  $('#login-pass').value = 'passphrase-kuat';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(900);
  assert.equal(window.location.hash, '#/app/chats');
});

test('home: shell navigasi, loading skeleton, lalu daftar chat + search', async () => {
  window.location.hash = '#/app/chats';
  renderRoute();
  await wait(60);
  assert.ok($('.skeleton'), 'skeleton tampil saat loading');
  assert.equal($$('.nav-item').length, 3, 'sidebar punya 3 item navigasi');
  assert.equal($$('.tabbar__item').length, 3, 'bottom nav punya 3 item');

  await wait(700);
  const rows = $$('.list-item');
  assert.ok(rows.length >= 5, `daftar chat tampil (${rows.length})`);
  assert.ok(document.body.textContent.includes('Tim Kantor'));

  // pencarian
  const search = $('.search input, input[type="search"]');
  search.value = 'tim kantor';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(30);
  assert.equal($$('.list-item').length, 1);

  search.value = 'zzzz-tidak-ada';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(30);
  assert.match(document.body.textContent, /Belum ada percakapan|Bersihkan pencarian/);
});

test('home: state error menampilkan panel error + tombol coba lagi', async () => {
  await goto('#/app/chats?state=error');
  assert.match(document.body.textContent, /Gagal memuat percakapan/);
  const retry = $('.state-view .btn');
  assert.ok(retry, 'tombol coba lagi ada');
  retry.click();
  await wait(800);
  assert.ok($$('.list-item').length >= 5, 'retry memuat daftar');
});

test('home: state kosong menampilkan empty state', async () => {
  await goto('#/app/chats?state=empty');
  assert.match(document.body.textContent, /Belum ada percakapan/);
});

test('home: chooser percakapan baru -> buat grup multi-select', async () => {
  await goto('#/app/chats');
  // Buka chooser lewat tombol +
  $('.panel__header .btn--primary').click();
  await wait(80);
  assert.match($('.modal').textContent, /Chat 1:1 dengan teman/);
  assert.match($('.modal').textContent, /Buat grup baru/);

  // Pilih "Buat grup baru"
  [...$$('.modal .menu-item')].find((b) => b.textContent.includes('Buat grup')).click();
  await wait(80);
  assert.match($('.modal').textContent, /Nama grup/);

  // Submit sebelum valid -> disabled
  const submit = [...$$('.modal__footer .btn')].find((b) => b.textContent.includes('Buat Grup'));
  assert.ok(submit.disabled, 'submit disabled saat nama kosong');

  // Isi nama + pilih 2 teman (tunggu listFriends demo selesai ~340ms)
  const nameInput = $('.modal input[type="text"]');
  nameInput.value = 'Grup Uji Smoke';
  nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(500);
  const rows = $$('.modal .list-item');
  assert.ok(rows.length >= 4, `daftar teman tampil (${rows.length})`);
  rows[0].click();
  rows[1].click();
  await wait(30);
  assert.ok(!submit.disabled, 'submit aktif setelah nama + teman dipilih');
  assert.match($('.modal').textContent, /2 teman dipilih/);

  // Submit -> navigasi ke chat grup (mode demo: createGroup dummy)
  submit.click();
  await wait(1200);
  assert.match(window.location.hash, /^#\/app\/chat\//);
  assert.match($('.chat-header__name').textContent, /Grup Uji Smoke/);
});

test('friends: tab, daftar teman, dan tambah teman via kode', async () => {
  await goto('#/app/friends');
  const tabs = $$('.tab');
  assert.equal(tabs.length, 3);
  assert.ok($$('.list-item').length >= 4, 'daftar teman tampil');

  // Tambah teman: kode valid milik Dimas (bukan teman, belum ada permintaan)
  $('header.panel__header .btn--primary').click();
  await wait(50);
  const modalInput = $('.modal input');
  assert.ok(modalInput, 'modal tambah teman terbuka');
  modalInput.value = 'KLIK-6B4W-5V9Z';
  $('.modal .input-group .btn').click();
  await wait(700);
  assert.match($('.modal').textContent, /Dimas Aryo/);

  // Kirim permintaan
  $('.modal .card .btn--primary').click();
  await wait(900);
  assert.equal($('.tab.is-active').dataset.tab, 'outgoing');
  assert.ok($$('.list-item').some((row) => row.textContent.includes('Fajar')));
  assert.ok($$('.list-item').some((row) => row.textContent.includes('Dimas')));

  // Tambah diri sendiri ditolak
  $('header.panel__header .btn--primary').click();
  await wait(50);
  $('.modal input').value = me.publicCode;
  $('.modal .input-group .btn').click();
  await wait(700);
  assert.match($('.modal').textContent, /tidak bisa menambahkan diri sendiri/i);
  $('.modal .modal__footer .btn').click();
});

test('friends: state loading tidak pernah selesai (skeleton permanen)', async () => {
  await goto('#/app/friends?state=loading', { settle: 600 });
  assert.ok($('.skeleton'), 'skeleton tetap tampil');
});

test('chat: memuat pesan, kirim pesan, status & balasan', async () => {
  await goto('#/app/chat/c_bima');
  assert.match($('.chat-header__name').textContent, /Bima Saputra/);
  assert.ok($$('.bubble').length >= 5, 'riwayat pesan tampil');
  assert.ok($('.day-divider'), 'pemisah hari tampil');

  const input = $('.composer__input');
  input.value = 'Pesan uji dari smoke test';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(600);
  const texts = $$('.bubble__text').map((n) => n.textContent);
  assert.ok(texts.includes('Pesan uji dari smoke test'), 'pesan terkirim tampil');
  const mine = $$('.msg-row--mine').at(-1);
  assert.ok(mine.querySelector('.msg-status'), 'status pesan milik sendiri tampil');
});

test('chat: state error pada room', async () => {
  await goto('#/app/chat/c_bima?state=error');
  assert.match(document.body.textContent, /Gagal memuat pesan/);
});

test('chat: room 2 anggota bisa dikonversi menjadi privat', async () => {
  await goto('#/app/chat/c_nadia');
  assert.ok($$('.bubble').length >= 1, 'pesan room tampil');

  $('.chat-header__identity').click();
  await wait(50);
  assert.match($('.drawer').textContent, /Room Biasa/);
  assert.match($('.drawer').textContent, /Konversi ke Chat Privat/);

  const convertBtn = [...$('.drawer').querySelectorAll('button')]
    .find((b) => b.textContent.includes('Ajukan konversi'));
  convertBtn.click();
  await wait(1600);
  assert.match($('.drawer').textContent, /Chat Privat/);
  assert.match(document.body.textContent, /resmi menjadi Chat Privat/);
});

test('chat: grup menolak konversi & menampilkan anggota + role', async () => {
  await goto('#/app/chat/c_kantor');
  assert.match($('.chat-header__name').textContent, /Tim Kantor/);
  assert.match(document.body.textContent, /5 anggota/);

  $('.chat-header__identity').click();
  await wait(700);
  const drawerText = $('.drawer').textContent;
  assert.match(drawerText, /Anggota/);
  assert.match(drawerText, /Admin/);
  assert.match(drawerText, /Keluar dari grup/);
  assert.ok(!drawerText.includes('Ajukan konversi'), 'grup tidak menawarkan konversi');
});

test('profile: kode akun, pengaturan tema, dan logout', async () => {
  await goto('#/app/profile');
  await wait(500);
  assert.match($('.label-code').textContent, /^KLIK-/);
  assert.match(document.body.textContent, /Cara memulihkan akun/);

  const darkBtn = [...$$('.segmented__btn')].find((b) => b.textContent === 'Gelap');
  darkBtn.click();
  await wait(30);
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  const autoBtn = [...$$('.segmented__btn')].find((b) => b.textContent === 'Auto');
  autoBtn.click();
  assert.equal(document.documentElement.hasAttribute('data-theme'), false);
});

test('profile: state error menampilkan retry', async () => {
  await goto('#/app/profile?state=error');
  assert.match(document.body.textContent, /Gagal memuat profil/);
});

test('route tidak dikenal menampilkan 404', async () => {
  navigate('/tidak-ada');
  renderRoute();
  await wait(60);
  assert.match(document.body.textContent, /404/);
});

test('scanner-service: detectScanner null di Node (tanpa kamera/BarcodeDetector)', async () => {
  const { detectScanner, isCapacitorRuntime } = await import('../src/services/scanner-service.js');
  assert.equal(isCapacitorRuntime(), false, 'Node bukan runtime Capacitor');
  const kind = await detectScanner();
  assert.equal(kind, null, 'tidak ada scanner di Node');
});

test('push-service: registerPushToken null di Node (bukan runtime native)', async () => {
  const { registerPushToken, pushStatus } = await import('../src/services/push-service.js');
  const token = await registerPushToken();
  assert.equal(token, null, 'push tidak didaftarkan di web/Node');
  const status = await pushStatus();
  assert.equal(status.available, false);
  assert.ok(status.reason.length > 0, 'alasan nonaktif dijelaskan');
});
