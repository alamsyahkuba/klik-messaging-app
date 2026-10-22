/**
 * Antrean pesan offline (Milestone 4).
 * Menyimpan pesan yang gagal/terblokir saat offline ke IndexedDB,
 * lalu dikirim ulang otomatis saat koneksi pulih (lihat flushOutbox
 * di chats-service.js).
 * - Browser : IndexedDB 'klik-outbox'.
 * - Tanpa IndexedDB (Node/uji otomatis): fallback memori sesi berjalan.
 */

const DB_NAME = 'klik-outbox';
const STORE = 'messages';

/** Fallback in-memory (saat IndexedDB tidak tersedia / gagal dibuka). */
const memory = new Map();

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IDB_UNAVAILABLE'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('IDB_OPEN_FAILED'));
    };
  });
  return dbPromise;
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Simpan pesan tertunda. Item: { id, roomId, text, replyTo, at }.
 * Gagal diamkan (queue tidak boleh menjatuhkan alur kirim).
 */
export async function enqueue(item) {
  memory.set(item.id, { ...item });
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    await promisifyRequest(tx.objectStore(STORE).put({ ...item }));
  } catch { /* fallback memori sudah terisi di atas */ }
}

/** Daftar semua pesan tertunda (urutan kirim). */
export async function listQueued() {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const rows = await promisifyRequest(tx.objectStore(STORE).getAll());
    if (rows?.length) return rows.sort((a, b) => String(a.at) < String(b.at) ? -1 : 1);
  } catch { /* gunakan memori */ }
  return [...memory.values()].sort((a, b) => String(a.at) < String(b.at) ? -1 : 1);
}

/** Hapus item dari antrean setelah terkirim (atau dibuang). */
export async function remove(id) {
  memory.delete(id);
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    await promisifyRequest(tx.objectStore(STORE).delete(id));
  } catch { /* memori sudah dibersihkan */ }
}

/** Jumlah pesan tertunda (untuk UI badge, dsb). */
export async function countQueued() {
  return (await listQueued()).length;
}
