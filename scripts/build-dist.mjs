/**
 * Build statis tanpa bundler: salin index.html + src/ ke dist/.
 * dist/ adalah webDir untuk Capacitor (lihat capacitor.config.ts).
 * Jalankan: npm run build:dist
 */
import { cp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, 'index.html'), path.join(dist, 'index.html'));
await cp(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });

try {
  await cp(path.join(root, 'vendor'), path.join(dist, 'vendor'), { recursive: true });
  console.log('vendor/ disalin (supabase UMD).');
} catch {
  console.warn('PERINGATAN: vendor/ tidak ada - jalankan `npm run sync:env` sebelum build supaya Supabase bisa dipakai di aplikasi.');
}

console.log('build:dist selesai -> dist/');
