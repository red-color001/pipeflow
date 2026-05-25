import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function applied(): Promise<Set<string>> {
  const rows = await query<{ id: string }>('SELECT id FROM schema_migrations');
  return new Set(rows.map((r) => r.id));
}

async function run() {
  await ensureMigrationsTable();
  const done = await applied();
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) {
      console.log(`= ${f} (already applied)`);
      continue;
    }
    const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
    console.log(`+ ${f}`);
    await query(sql);
    await query('INSERT INTO schema_migrations (id) VALUES ($1)', [f]);
  }
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
