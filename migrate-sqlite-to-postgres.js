// migrate-sqlite-to-postgres.js — one-off copy of an existing spendsense.db
// into the Postgres database the app now uses.
//
//   local (PGlite):   npm run migrate
//   Netlify DB:       NETLIFY_DATABASE_URL="postgres://..." npm run migrate
//
// Safe to inspect first: pass --dry to report what would be copied.
const path = require('path');
const fs = require('fs');
const db = require('./db');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, 'spendsense.db');
const DRY = process.argv.includes('--dry');

// id order matters: parents before the rows that reference them
const TABLES = [
  ['users',           ['id', 'name', 'email', 'password_hash']],
  ['categories',      ['id', 'user_id', 'name', 'icon', 'monthly_limit']],
  ['expenses',        ['id', 'user_id', 'description', 'amount', 'category_id', 'date', 'note']],
  ['recurring',       ['id', 'user_id', 'description', 'amount', 'category_id', 'period', 'next_date']],
  ['settings',        ['user_id', 'key', 'value']],
  ['members',         ['id', 'user_id', 'name']],
  ['shared_expenses', ['id', 'user_id', 'description', 'amount', 'paid_by', 'date']],
  ['shared_splits',   ['id', 'shared_id', 'member_id', 'share']],
];

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`No SQLite database at ${SQLITE_PATH}. Set SQLITE_PATH to point at it.`);
    process.exit(1);
  }

  let Database;
  try { Database = require('better-sqlite3'); }
  catch {
    console.error('better-sqlite3 is needed for the migration. Run: npm install --include=dev');
    process.exit(1);
  }

  const src = new Database(SQLITE_PATH, { readonly: true });
  await db.ready();

  const target = await db.row('SELECT COUNT(*)::int AS c FROM users');
  if (target.c > 0 && !DRY) {
    console.error(`Target database already has ${target.c} user(s). Refusing to merge into it.`);
    console.error('Point at an empty database, or delete those rows first.');
    process.exit(1);
  }

  console.log(`Source: ${SQLITE_PATH}`);
  let total = 0;

  for (const [table, cols] of TABLES) {
    let rows;
    try { rows = src.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all(); }
    catch (e) { console.log(`  ${table.padEnd(16)} skipped (${e.message})`); continue; }

    console.log(`  ${table.padEnd(16)} ${rows.length} row(s)`);
    total += rows.length;
    if (DRY || !rows.length) continue;

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    await db.tx(async (t) => {
      for (const r of rows) {
        await t.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`,
          cols.map((c) => r[c]));
      }
    });
  }

  if (!DRY) {
    // The explicit ids above bypassed the sequences, so move them past the max.
    for (const [table, cols] of TABLES) {
      if (!cols.includes('id')) continue;
      await db.run(
        `SELECT setval(pg_get_serial_sequence($1,'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`,
        [table]);
    }
    console.log('Sequences reset.');
  }

  console.log(DRY ? `\nDry run: ${total} row(s) would be copied.` : `\nMigrated ${total} row(s).`);
  src.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
