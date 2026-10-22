/**
 * Klien Supabase untuk browser (tanpa bundler).
 * Library di-load dari vendor/supabase.js (UMD) via <script> di index.html;
 * di sini hanya dibuat instance client-nya.
 * Mode demo: saat berjalan di Node (uji otomatis) atau config kosong,
 * semua service memakai jalur dummy seperti Milestone 1.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, BACKEND_ENABLED } from '../config.js';

let client = null;

/** True bila layak memakai backend nyata (config terisi + bukan lingkungan Node). */
export function isLive() {
  return Boolean(BACKEND_ENABLED && typeof window !== 'undefined' && window.supabase?.createClient);
}

/** Instance supabase-js (lazy). Melempar error bila library belum termuat. */
export function getSupabase() {
  if (!isLive()) {
    throw new Error('Library supabase-js belum dimuat (vendor/supabase.js). Jalankan npm run sync:env.');
  }
  if (!client) {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

/**
 * Terapkan state preview (?state=loading|error|empty) bahkan di mode live,
 * agar pemeriksaan UI manual tetap berfungsi tanpa menyentuh jaringan.
 * Kembalikan true bila preview yang menangani permintaan.
 */
export async function previewState(state, demoRun) {
  if (!state || state === 'ok') return false;
  await demoRun(state);
  return true;
}
