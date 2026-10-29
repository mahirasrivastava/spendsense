// db.js — Postgres access layer.
//
//   production : any Postgres (Render, Railway, Neon, Supabase) via DATABASE_URL
//   local dev  : PGlite, a real Postgres engine embedded in the process, so
//                there is nothing to install and the SQL dialect is identical.
//
// Everything is async: unlike better-sqlite3, no Postgres driver is synchronous.

// Netlify has used more than one name for this: the current @netlify/database
// package sets NETLIFY_DB_URL, the older @netlify/neon one set
// NETLIFY_DATABASE_URL. Accept either, plus a plain DATABASE_URL for any host.
const CONN = process.env.NETLIFY_DB_URL
  || process.env.NETLIFY_DATABASE_URL
  || process.env.DATABASE_URL
  || '';

let driver = null;

async function connect() {
  if (driver) return driver;

  if (CONN) {
    const { Pool } = require('pg');
    // TLS is driven by the connection string's sslmode, so certificates are
    // still verified. Managed providers want `?sslmode=require`; an in-network
    // database (Render's internal host) wants `?sslmode=disable`.
    const pool = new Pool({ connectionString: CONN, max: Number(process.env.PG_POOL_MAX || 5) });
    driver = {
      kind: 'postgres',
      query: (text, params = []) => pool.query(text, params),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (t, p = []) => client.query(t, p) });
          await client.query('COMMIT');
          return out;
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch {}
          throw err;
        } finally {
          client.release();
        }
      },
    };
  } else {
    // On a serverless platform there is no writable disk and no local engine to
    // fall back to. Fail loudly here rather than producing a confusing EROFS
    // deep inside PGlite on the first request.
    if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY || process.env.NODE_ENV === 'production') {
      throw new Error(
        'No database connection string. Set NETLIFY_DB_URL (or DATABASE_URL). ' +
        'On Netlify, run: npx netlify-cli database init');
    }
    const path = require('path');
    const { PGlite } = require('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || path.join(__dirname, '.pgdata');
    const pg = new PGlite(dir);
    await pg.waitReady;
    driver = {
      kind: 'pglite',
      query: (text, params = []) => pg.query(text, params),
      // PGlite is a single connection, so the transaction just brackets statements
      async tx(fn) {
        await pg.exec('BEGIN');
        try {
          const out = await fn({ query: (t, p = []) => pg.query(t, p) });
          await pg.exec('COMMIT');
          return out;
        } catch (err) {
          try { await pg.exec('ROLLBACK'); } catch {}
          throw err;
        }
      },
    };
  }
  return driver;
}

/* ---------------- schema ---------------- */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  icon          TEXT NOT NULL DEFAULT 'package',
  monthly_limit DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS expenses (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount      DOUBLE PRECISION NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  date        TEXT NOT NULL,
  note        TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recurring (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount      DOUBLE PRECISION NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  period      TEXT NOT NULL CHECK (period IN ('weekly','monthly')),
  next_date   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT
);
CREATE TABLE IF NOT EXISTS members (
  id      SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shared_expenses (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount      DOUBLE PRECISION NOT NULL,
  paid_by     INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shared_splits (
  id        SERIAL PRIMARY KEY,
  shared_id INTEGER NOT NULL REFERENCES shared_expenses(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  share     DOUBLE PRECISION NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name ON categories(user_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_user_key    ON settings(user_id, key);
CREATE INDEX IF NOT EXISTS idx_expenses_user_date          ON expenses(user_id, date);
CREATE INDEX IF NOT EXISTS idx_sessions_user               ON sessions(user_id);
`;

let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d = await connect();
      // PGlite cannot run a multi-statement string through query(), so split it
      for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
        await d.query(stmt);
      }
      return d;
    })();
  }
  return readyPromise;
}

/* ---------------- helpers ---------------- */
// rows(sql, params) -> array      row(sql, params) -> first row or undefined
async function rows(text, params = []) {
  const d = await ready();
  const res = await d.query(text, params);
  return res.rows;
}
async function row(text, params = []) {
  return (await rows(text, params))[0];
}
async function run(text, params = []) {
  const d = await ready();
  return d.query(text, params);
}
async function tx(fn) {
  const d = await ready();
  return d.tx(fn);
}
const num = (v) => (v == null ? 0 : Number(v));   // Postgres returns numeric as string

module.exports = { ready, rows, row, run, tx, num, connect, SCHEMA };
