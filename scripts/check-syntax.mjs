/**
 * Pemeriksaan sintaks + graph modul ES tanpa browser.
 * Setiap file src/**\/*.js diimpor di Node; modul yang menyentuh
 * DOM/DOM API di top-level akan gagal di sini (tidak diinginkan).
 * Jalankan: npm run check
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');

async function collectJs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectJs(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

const files = (await collectJs(srcDir)).sort();
const failures = [];

for (const file of files) {
  const rel = path.relative(root, file);
  try {
    await import(pathToFileURL(file).href);
    console.log(`ok    ${rel}`);
  } catch (error) {
    failures.push({ rel, error });
    console.error(`FAIL  ${rel}\n      ${error.message}`);
  }
}

console.log(`\n${files.length - failures.length}/${files.length} modul lulus.`);
if (failures.length) process.exit(1);
