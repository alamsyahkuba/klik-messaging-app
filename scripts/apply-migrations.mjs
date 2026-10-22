/**
 * Utilitas pengembang: terapkan file migrasi ke project Supabase remote
 * memakai Management API (PAT dari `supabase login`).
 * Catatan: hanya untuk workflow tanpa akses password DB; jalur resmi tetap
 * `supabase db push`. Versi tercatat di supabase_migrations.schema_migrations.
 * Jalankan: node scripts/apply-migrations.mjs [project-ref]
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRef = process.argv[2] || 'fkilgzkkzerpuapxfqka';

const token = (await readFile(path.join(os.homedir(), '.supabase', 'access-token'), 'utf8')).trim();
const migrationsDir = path.join(root, 'supabase', 'migrations');

async function runSql(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text;
}

await runSql(`
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text,
  created_by text default 'applied-via-management-api',
  migration_order integer
);
`);

const applied = JSON.parse(await runSql(
  'select version from supabase_migrations.schema_migrations order by version',
));
const appliedVersions = new Set(applied.map((row) => row.version));

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
let order = 0;

for (const file of files) {
  const version = file.replace(/\.sql$/, '');
  order += 1;
  if (appliedVersions.has(version)) {
    console.log(`skip  ${file} (sudah terpasang)`);
    continue;
  }
  const sql = await readFile(path.join(migrationsDir, file), 'utf8');
  try {
    await runSql(sql);
    const escaped = sql.replace(/'/g, "''");
    await runSql(`
      insert into supabase_migrations.schema_migrations (version, statements, name, migration_order)
      values ('${version}', array['${escaped}'], '${file}', ${order})
      on conflict (version) do nothing;
    `);
    console.log(`ok    ${file}`);
  } catch (error) {
    console.error(`FAIL  ${file}\n      ${error.message}`);
    process.exit(1);
  }
}
console.log('Semua migrasi diterapkan.');
