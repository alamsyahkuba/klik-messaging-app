/**
 * Sinkronkan .env -> src/config.js + vendor library runtime (tanpa bundler).
 * - src/config.js : SUPABASE_URL + SUPABASE_ANON_KEY untuk frontend
 *   (anon key memang dirancang publik; service role TIDAK pernah masuk sini)
 * - vendor/supabase.js : build UMD dari node_modules/@supabase/supabase-js
 *   (di-load via <script> biasa, dipakai sebagai window.supabase.createClient)
 * Jalankan: npm run sync:env  (atau: node scripts/sync-env.mjs)
 */
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const envPath = path.join(root, '.env');
let env = {};
try {
  env = parseEnv(await readFile(envPath, 'utf8'));
} catch {
  console.warn('PERINGATAN: .env tidak ditemukan - src/config.js dibuat kosong (mode demo).');
}

const url = env.SUPABASE_URL || '';
const anonKey = env.SUPABASE_ANON_KEY || '';

const config = `/**
 * Hasil generate scripts/sync-env.mjs - JANGAN edit manual.
 * Anon key aman untuk frontend (dibatasi RLS). Service role tidak pernah
 * disimpan di file ini.
 */
export const SUPABASE_URL = ${JSON.stringify(url)};
export const SUPABASE_ANON_KEY = ${JSON.stringify(anonKey)};
export const BACKEND_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
`;

await writeFile(path.join(root, 'src', 'config.js'), config);
console.log(`src/config.js diperbarui (backend: ${url ? 'AKTIF' : 'nonaktif / mode demo'})`);

const umdSrc = path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
const vendorDir = path.join(root, 'vendor');
await mkdir(vendorDir, { recursive: true });
try {
  await copyFile(umdSrc, path.join(vendorDir, 'supabase.js'));
  console.log('vendor/supabase.js disalin dari node_modules (UMD).');
} catch {
  console.error('GAGAL: node_modules/@supabase/supabase-js/dist/umd/supabase.js tidak ada. Jalankan npm install lalu ulangi.');
  process.exit(1);
}
