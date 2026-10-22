import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatClock, formatDayLabel, formatListTime, formatRelative, isSameDay,
} from '../src/utils/format-time.js';
import {
  normalizeAccountCode, initials, hashString, localId,
} from '../src/utils/id.js';
import { matchRoute } from '../src/router/router.js';

test('formatClock selalu HH:MM', () => {
  const d = new Date(2026, 9, 21, 9, 5);
  assert.equal(formatClock(d), '09:05');
  assert.equal(formatClock(new Date(2026, 9, 21, 23, 59)), '23:59');
});

test('formatDayLabel membedakan hari ini / kemarin / tanggal', () => {
  assert.equal(formatDayLabel(new Date()), 'Hari ini');
  const kemarin = new Date(Date.now() - 86400000);
  assert.equal(formatDayLabel(kemarin), 'Kemarin');
  const lama = new Date(2025, 0, 15);
  assert.equal(formatDayLabel(lama), '15 Januari 2025');
});

test('formatListTime untuk hari ini menghasilkan jam', () => {
  assert.match(formatListTime(new Date()), /^\d{2}:\d{2}$/);
});

test('formatRelative menghasilkan teks berbahasa Indonesia', () => {
  assert.equal(formatRelative(new Date()), 'baru saja');
  assert.equal(formatRelative(Date.now() - 5 * 60000), '5 menit lalu');
  assert.equal(formatRelative(Date.now() - 3 * 3600000), '3 jam lalu');
});

test('isSameDay membandingkan tanggal kalender', () => {
  assert.equal(isSameDay(new Date(2026, 9, 21, 1, 0), new Date(2026, 9, 21, 23, 0)), true);
  assert.equal(isSameDay(new Date(2026, 9, 21), new Date(2026, 9, 22)), false);
});

test('normalizeAccountCode menyeragamkan input kode akun', () => {
  assert.equal(normalizeAccountCode(' klik-7q2m-9x4d '), 'KLIK7Q2M9X4D');
  assert.equal(normalizeAccountCode('KLIK 7Q2M 9X4D'), 'KLIK7Q2M9X4D');
});

test('initials mengambil 1-2 huruf pertama', () => {
  assert.equal(initials('Alya Putri'), 'AP');
  assert.equal(initials('Bima'), 'BI');
  assert.equal(initials(''), '?');
});

test('hashString deterministik', () => {
  assert.equal(hashString('Nadia'), hashString('Nadia'));
  assert.notEqual(hashString('Nadia'), hashString('Bima'));
});

test('localId unik', () => {
  assert.notEqual(localId(), localId());
  assert.match(localId('m'), /^m_/);
});

test('matchRoute menangkap parameter', () => {
  assert.deepEqual(matchRoute('/app/chat/:id', '/app/chat/c_bima'), { id: 'c_bima' });
  assert.deepEqual(matchRoute('/app/chats', '/app/chats'), {});
  assert.equal(matchRoute('/app/chat/:id', '/app/chats'), null);
  assert.equal(matchRoute('/app/chats', '/app/chat/c_bima'), null);
  assert.deepEqual(matchRoute('/a/:x/b', '/a/1/b'), { x: '1' });
});
