const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const pad = (n) => String(n).padStart(2, '0');

/** "HH:MM" */
export function formatClock(date) {
  const d = toDate(date);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Waktu relatif untuk daftar chat: "09:42", "Kemarin", "12 Okt", "12 Okt 2025" */
export function formatListTime(date) {
  const d = toDate(date);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfToday - startOfThat) / 86400000);

  if (diffDays === 0) return formatClock(d);
  if (diffDays === 1) return 'Kemarin';
  if (diffDays < 7) return HARI[d.getDay()];
  if (d.getFullYear() === now.getFullYear()) return `${d.getDate()} ${BULAN[d.getMonth()]}`;
  return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

/** Label pemisah hari di dalam ruang chat: "Hari ini", "Kemarin", "12 Oktober 2025" */
export function formatDayLabel(date) {
  const d = toDate(date);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfToday - startOfThat) / 86400000);
  const PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  if (diffDays === 0) return 'Hari ini';
  if (diffDays === 1) return 'Kemarin';
  if (diffDays < 7) return HARI[d.getDay()];
  return `${d.getDate()} ${PANJANG[d.getMonth()]} ${d.getFullYear()}`;
}

/** "5 menit lalu", "2 jam lalu", "3 hari lalu" */
export function formatRelative(date) {
  const d = toDate(date);
  const diffMs = Date.now() - d.getTime();
  const menit = Math.floor(diffMs / 60000);
  if (menit < 1) return 'baru saja';
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  if (hari < 7) return `${hari} hari lalu`;
  return formatListTime(d);
}

export function isSameDay(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

export function toDate(value) {
  if (value instanceof Date) return value;
  return new Date(value);
}
