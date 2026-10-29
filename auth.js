// auth.js — password hashing, sessions and route guards.
// Uses node:crypto scrypt so there is no native bcrypt dependency to build.
const crypto = require('crypto');
const db = require('./db');   // Postgres helpers: rows/row/run/tx

const COOKIE = 'ss_session';
const SESSION_DAYS = 7;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ---------------- password hashing ---------------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, keyHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const key = Buffer.from(keyHex, 'hex');
    const test = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), key.length,
      { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(key, test); // constant time
  } catch { return false; }
}

/* ---------------- sessions ---------------- */
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  // only the hash is stored, so a database leak does not hand over live sessions
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)',
    [sha256(token), userId, expires.toISOString()]);
  return { token, expires };
}

async function userForToken(token) {
  if (!token) return null;
  const hash = sha256(token);
  const r = await db.row(`
    SELECT s.expires_at, u.id, u.name, u.email
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1
  `, [hash]);
  if (!r) return null;
  if (new Date(r.expires_at) < new Date()) {
    await db.run('DELETE FROM sessions WHERE token_hash=$1', [hash]);
    return null;
  }
  return { id: r.id, name: r.name, email: r.email };
}

async function destroySession(token) {
  if (token) await db.run('DELETE FROM sessions WHERE token_hash=$1', [sha256(token)]);
}

async function purgeExpiredSessions() {
  await db.run('DELETE FROM sessions WHERE expires_at < now()');
}

/* ---------------- cookies ---------------- */
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(res, token, expires) {
  const bits = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',                 // not reachable from JavaScript, so XSS cannot steal it
    'SameSite=Lax',             // blocks cross-site form CSRF while keeping normal navigation
    `Expires=${expires.toUTCString()}`,
  ];
  // over HTTPS the cookie must not be sent in the clear
  if (process.env.SECURE_COOKIES === '1' || process.env.NODE_ENV === 'production') bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ---------------- middleware ---------------- */
// Attaches req.user when a valid session cookie is present. Never rejects.
async function attachUser(req, res, next) {
  try {
    req.sessionToken = readCookie(req, COOKIE);
    req.user = await userForToken(req.sessionToken);
    next();
  } catch (err) { next(err); }
}

// Guards JSON API routes.
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue' });
  next();
}

// Guards HTML pages: sends people to the login page with a return path.
function requirePage(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.path));
  next();
}

/* ---------------- login throttling ---------------- */
// Small in-memory limiter. Enough to blunt online guessing on a single-process app.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

// keeps the map from growing without bound on a long-lived server
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, v] of attempts) if (v.first < cutoff) attempts.delete(k);
}, WINDOW_MS).unref();

function tooManyAttempts(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return false; }
  return rec.count >= MAX_ATTEMPTS;
}
function noteFailure(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else rec.count++;
}
const clearAttempts = (key) => attempts.delete(key);

/* ---------------- new-account setup ---------------- */
const DEFAULT_CATEGORIES = [
  ['Food', 'utensils', 4000], ['Transport', 'bus', 1500], ['Groceries', 'shopping-cart', 3000],
  ['Entertainment', 'film', 1200], ['Education', 'book', 2000], ['Shopping', 'shopping-bag', 2500],
  ['Bills', 'lightbulb', 2000], ['Other', 'package', 1000],
];

// The demo data that shipped before accounts existed has user_id IS NULL.
// The first account to sign up adopts it; later accounts start clean.
async function claimOrphanData(userId) {
  const orphan = await db.row('SELECT COUNT(*)::int AS c FROM categories WHERE user_id IS NULL');
  if (!orphan || !orphan.c) return false;
  await db.tx(async (t) => {
    for (const table of ['categories', 'expenses', 'recurring', 'members', 'shared_expenses', 'settings']) {
      await t.query(`UPDATE ${table} SET user_id=$1 WHERE user_id IS NULL`, [userId]);
    }
  });
  return true;
}

async function seedNewUser(userId) {
  if (await claimOrphanData(userId)) return;
  await db.tx(async (t) => {
    for (const [name, icon, limit] of DEFAULT_CATEGORIES) {
      await t.query('INSERT INTO categories (user_id, name, icon, monthly_limit) VALUES ($1,$2,$3,$4)',
        [userId, name, icon, limit]);
    }
    await t.query('INSERT INTO settings (user_id, key, value) VALUES ($1,$2,$3)', [userId, 'monthly_budget', '0']);
    await t.query('INSERT INTO settings (user_id, key, value) VALUES ($1,$2,$3)', [userId, 'savings_goal', '0']);
  });
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, createSession, userForToken, destroySession,
  purgeExpiredSessions, readCookie, setSessionCookie, clearSessionCookie,
  attachUser, requireAuth, requirePage,
  tooManyAttempts, noteFailure, clearAttempts, seedNewUser,
};
