// server.js — Express backend: serves the pages + all /api routes, backed by Postgres.
// Exported as an app so it can run standalone (node server.js) or inside a
// Netlify Function (netlify/functions/api.js).
const express = require('express');
const path = require('path');
const db = require('./db');
const seed = require('./seed');
const auth = require('./auth');
const importer = require('./importer');

const app = express();
const PROD = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
// Hosting platforms terminate TLS at a proxy; without this req.ip is the
// proxy's address (breaking the login throttle) and req.secure is always false.
if (PROD) app.set('trust proxy', 1);

app.use((req, res, next) => {
  if (PROD && req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(308, 'https://' + req.headers.host + req.originalUrl);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

// CSRF defence: a cross-site form cannot set these headers, and every mutating
// route here is JSON-only. Requests carrying a foreign Origin are rejected.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Blocked cross-site request' });
  }
  next();
});

app.use(express.json({ limit: '4mb' }));  // statement text can be large

// Only /assets is public. Page HTML lives in views/ so protected pages cannot
// be fetched directly as static files.
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), { maxAge: '1h' }));

// Express 4 does not catch rejected promises, so every async handler is wrapped.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use(ah(auth.attachUser));

const PORT = process.env.PORT || 8000;
const round = (n) => Math.round(Number(n) * 100) / 100;
// Dates are formatted in LOCAL time. toISOString() converts to UTC first, which
// in any UTC+ timezone rolls local midnight back into the previous day/month.
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localMonth = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const monthKey = (d) => localMonth(d ? new Date(d) : new Date());
const todayStr = () => localDate();
const bad = (res, m) => res.status(400).json({ error: m });
const page = (name) => (req, res) => res.sendFile(path.join(__dirname, 'views', name));
const uid = (req) => req.user.id;

// ---------------- pages ----------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'landing.html')));
app.get('/login', (req, res) => (req.user ? res.redirect('/app') : page('login.html')(req, res)));
app.get('/signup', (req, res) => (req.user ? res.redirect('/app') : page('signup.html')(req, res)));
app.get('/app', auth.requirePage, page('app.html'));

// ---------------- auth API ----------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

app.post('/api/auth/signup', ah(async (req, res) => {
  const throttleKey = 'signup|' + (req.ip || '');
  if (auth.tooManyAttempts(throttleKey)) {
    return res.status(429).json({ error: 'Too many sign-up attempts. Please wait a few minutes.' });
  }
  auth.noteFailure(throttleKey);   // counts attempts; cleared on success below

  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (name.length < 2) return bad(res, 'Please enter your full name');
  if (!EMAIL_RE.test(email)) return bad(res, 'Please enter a valid email address');
  if (password.length < 8) return bad(res, 'Password must be at least 8 characters');
  if (password.length > 200) return bad(res, 'Password is too long');

  if (await db.row('SELECT id FROM users WHERE email = $1', [email])) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  let userId;
  try {
    const r = await db.row('INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id',
      [name, email, auth.hashPassword(password)]);
    userId = r.id;
  } catch {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  await auth.seedNewUser(userId);
  auth.clearAttempts(throttleKey);

  const { token, expires } = await auth.createSession(userId);
  auth.setSessionCookie(res, token, expires);
  res.json({ user: { id: userId, name, email } });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const key = email + '|' + (req.ip || '');

  if (auth.tooManyAttempts(key)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }
  const user = await db.row('SELECT * FROM users WHERE email = $1', [email]);
  // Same message either way, so the response cannot be used to enumerate accounts.
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    auth.noteFailure(key);
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  auth.clearAttempts(key);
  const { token, expires } = await auth.createSession(user.id);
  auth.setSessionCookie(res, token, expires);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
}));

app.post('/api/auth/logout', ah(async (req, res) => {
  await auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
}));

app.get('/api/auth/me', (req, res) => res.json({ user: req.user || null }));

// Everything past this point needs a session.
app.use('/api', auth.requireAuth);

// ---------------- categories ----------------
app.get('/api/categories', ah(async (req, res) => {
  const month = req.query.month || monthKey();
  res.json(await db.rows(`
    SELECT c.*,
      COALESCE((SELECT SUM(amount) FROM expenses e
                WHERE e.category_id = c.id AND e.user_id = c.user_id AND substr(e.date,1,7) = $1),0)::float8 AS spent
    FROM categories c WHERE c.user_id = $2 ORDER BY c.name
  `, [month, uid(req)]));
}));

app.post('/api/categories', ah(async (req, res) => {
  const b = req.body, a = b.action;
  if (a === 'add') {
    if (!(b.name || '').trim()) return bad(res, 'Category name required');
    try {
      await db.run('INSERT INTO categories (user_id, name, icon, monthly_limit) VALUES ($1,$2,$3,$4)',
        [uid(req), b.name.trim(), b.icon || 'package', Number(b.monthly_limit) || 0]);
    } catch { return bad(res, 'You already have a category with that name'); }
    return res.json({ ok: true });
  }
  if (a === 'update') {
    const r = await db.run('UPDATE categories SET monthly_limit=$1, icon=$2 WHERE id=$3 AND user_id=$4',
      [Number(b.monthly_limit) || 0, b.icon || 'package', b.id, uid(req)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Category not found' });
    return res.json({ ok: true });
  }
  if (a === 'delete') {
    await db.run('UPDATE expenses SET category_id=NULL WHERE category_id=$1 AND user_id=$2', [b.id, uid(req)]);
    const r = await db.run('DELETE FROM categories WHERE id=$1 AND user_id=$2', [b.id, uid(req)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Category not found' });
    return res.json({ ok: true });
  }
  bad(res, 'Unknown action');
}));

// ---------------- expenses ----------------
app.get('/api/expenses', ah(async (req, res) => {
  const month = req.query.month || monthKey();
  res.json(await db.rows(`
    SELECT e.*, c.name AS category, c.icon
    FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.user_id = $1 AND substr(e.date,1,7) = $2 ORDER BY e.date DESC, e.id DESC
  `, [uid(req), month]));
}));

app.post('/api/expenses', ah(async (req, res) => {
  const b = req.body;
  if (b.action === 'add') {
    const desc = (b.description || '').trim(), amt = Number(b.amount);
    if (!desc) return bad(res, 'Please add a description');
    if (!(amt > 0)) return bad(res, 'Amount must be greater than zero');
    // a category may only be attached if it belongs to this account
    let catId = b.category_id || null;
    if (catId) {
      const owned = await db.row('SELECT id FROM categories WHERE id=$1 AND user_id=$2', [catId, uid(req)]);
      if (!owned) catId = null;
    }
    const r = await db.row(
      'INSERT INTO expenses (user_id, description, amount, category_id, date, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [uid(req), desc, amt, catId, b.date || todayStr(), (b.note || '').trim()]);
    return res.json({ id: r.id });
  }
  if (b.action === 'delete') {
    const r = await db.run('DELETE FROM expenses WHERE id=$1 AND user_id=$2', [b.id, uid(req)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Expense not found' });
    return res.json({ ok: true });
  }
  bad(res, 'Unknown action');
}));

// ---------------- budget ----------------
async function getSetting(userId, k, d = '0') {
  const r = await db.row('SELECT value FROM settings WHERE user_id=$1 AND key=$2', [userId, k]);
  return r ? r.value : d;
}
const setSetting = (userId, k, v) => db.run(`
  INSERT INTO settings (user_id, key, value) VALUES ($1,$2,$3)
  ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value
`, [userId, k, v]);

app.get('/api/budget', ah(async (req, res) => {
  const month = req.query.month || monthKey();
  const s = await db.row('SELECT COALESCE(SUM(amount),0)::float8 AS s FROM expenses WHERE user_id=$1 AND substr(date,1,7)=$2',
    [uid(req), month]);
  const spent = db.num(s.s);
  const budget = Number(await getSetting(uid(req), 'monthly_budget', '0'));
  res.json({ budget, spent: round(spent), remaining: round(budget - spent),
    savings_goal: Number(await getSetting(uid(req), 'savings_goal', '0')) });
}));

app.post('/api/budget', ah(async (req, res) => {
  const b = req.body;
  if (b.action === 'set') {
    const budget = Number(b.budget), goal = Number(b.savings_goal);
    if (b.budget !== undefined && (!Number.isFinite(budget) || budget < 0)) return bad(res, 'Budget must be zero or more');
    if (b.savings_goal !== undefined && (!Number.isFinite(goal) || goal < 0)) return bad(res, 'Savings goal must be zero or more');
    if (b.budget !== undefined) await setSetting(uid(req), 'monthly_budget', String(budget));
    if (b.savings_goal !== undefined) await setSetting(uid(req), 'savings_goal', String(goal));
    return res.json({ ok: true });
  }
  bad(res, 'Unknown action');
}));

// ---------------- recurring ----------------
app.get('/api/recurring', ah(async (req, res) => {
  res.json(await db.rows(`
    SELECT r.*, c.name AS category, c.icon FROM recurring r
    LEFT JOIN categories c ON c.id = r.category_id
    WHERE r.user_id = $1 ORDER BY r.next_date
  `, [uid(req)]));
}));

app.post('/api/recurring', ah(async (req, res) => {
  const b = req.body;
  if (b.action === 'add') {
    const desc = (b.description || '').trim(), amt = Number(b.amount), period = b.period || 'monthly';
    if (!desc) return bad(res, 'Please add a description');
    if (!(amt > 0)) return bad(res, 'Amount must be greater than zero');
    if (!['weekly', 'monthly'].includes(period)) return bad(res, 'Invalid period');
    await db.run('INSERT INTO recurring (user_id, description, amount, category_id, period, next_date) VALUES ($1,$2,$3,$4,$5,$6)',
      [uid(req), desc, amt, b.category_id || null, period, b.next_date || todayStr()]);
    return res.json({ ok: true });
  }
  if (b.action === 'delete') {
    const r = await db.run('DELETE FROM recurring WHERE id=$1 AND user_id=$2', [b.id, uid(req)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true });
  }
  if (b.action === 'run') {
    const today = todayStr();
    const due = await db.rows('SELECT * FROM recurring WHERE user_id=$1 AND next_date <= $2', [uid(req), today]);
    let created = 0;
    await db.tx(async (t) => {
      for (const r of due) {
        let cursor = r.next_date;
        while (cursor <= today) {
          await t.query('INSERT INTO expenses (user_id, description, amount, category_id, date, note) VALUES ($1,$2,$3,$4,$5,$6)',
            [uid(req), r.description, r.amount, r.category_id, cursor, 'recurring']);
          created++;
          const d = new Date(cursor + 'T00:00:00');
          if (r.period === 'weekly') d.setDate(d.getDate() + 7); else d.setMonth(d.getMonth() + 1);
          cursor = localDate(d);
        }
        await t.query('UPDATE recurring SET next_date=$1 WHERE id=$2', [cursor, r.id]);
      }
    });
    return res.json({ created });
  }
  bad(res, 'Unknown action');
}));

// ---------------- shared (roommate splitting) ----------------
const members = (userId) => db.rows('SELECT * FROM members WHERE user_id=$1 ORDER BY id', [userId]);

async function balances(userId) {
  const mem = await members(userId);
  const net = {};
  mem.forEach((m) => (net[m.id] = 0));
  (await db.rows('SELECT paid_by, SUM(amount)::float8 AS s FROM shared_expenses WHERE user_id=$1 GROUP BY paid_by', [userId]))
    .forEach((r) => { if (r.paid_by in net) net[r.paid_by] += db.num(r.s); });
  (await db.rows(`
    SELECT sp.member_id, SUM(sp.share)::float8 AS s FROM shared_splits sp
    JOIN shared_expenses se ON se.id = sp.shared_id
    WHERE se.user_id = $1 GROUP BY sp.member_id
  `, [userId])).forEach((r) => { if (r.member_id in net) net[r.member_id] -= db.num(r.s); });
  return mem.map((m) => ({ id: m.id, name: m.name, net: round(net[m.id] || 0) }));
}

async function settle(userId) {
  const bal = (await balances(userId)).map((b) => ({ ...b }));
  const cred = bal.filter((b) => b.net > 0.01).sort((a, b) => b.net - a.net);
  const deb = bal.filter((b) => b.net < -0.01).sort((a, b) => a.net - b.net);
  const tx = []; let i = 0, j = 0;
  while (i < deb.length && j < cred.length) {
    const pay = round(Math.min(-deb[i].net, cred[j].net));
    if (pay > 0) { tx.push({ from: deb[i].name, to: cred[j].name, amount: pay }); deb[i].net += pay; cred[j].net -= pay; }
    if (Math.abs(deb[i].net) < 0.01) i++;
    if (Math.abs(cred[j].net) < 0.01) j++;
  }
  return tx;
}

app.get('/api/shared', ah(async (req, res) => {
  const expenses = await db.rows(`
    SELECT s.*, m.name AS paid_by_name FROM shared_expenses s
    JOIN members m ON m.id = s.paid_by
    WHERE s.user_id = $1 ORDER BY s.date DESC, s.id DESC
  `, [uid(req)]);
  res.json({
    members: await members(uid(req)),
    expenses,
    balances: await balances(uid(req)),
    settle: await settle(uid(req)),
  });
}));

app.post('/api/shared', ah(async (req, res) => {
  const b = req.body;
  if (b.action === 'add_member') {
    if (!(b.name || '').trim()) return bad(res, 'Name required');
    await db.run('INSERT INTO members (user_id, name) VALUES ($1,$2)', [uid(req), b.name.trim()]);
    return res.json({ ok: true });
  }
  if (b.action === 'add_expense') {
    const desc = (b.description || '').trim(), amt = Number(b.amount);
    const ids = (b.member_ids || []).map(Number);
    if (!desc) return bad(res, 'Please add a description');
    if (!(amt > 0)) return bad(res, 'Amount must be greater than zero');
    if (!Array.isArray(ids) || !ids.length) return bad(res, 'Select who shared it');

    // every member referenced must belong to this account
    const owned = new Set((await members(uid(req))).map((m) => m.id));
    if (!owned.has(Number(b.paid_by)) || ids.some((id) => !owned.has(id))) {
      return bad(res, 'Unknown member');
    }
    const sid = (await db.row(
      'INSERT INTO shared_expenses (user_id, description, amount, paid_by, date) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [uid(req), desc, amt, Number(b.paid_by), b.date || todayStr()])).id;
    const each = round(amt / ids.length);
    await db.tx(async (t) => {
      for (const [k, mid] of ids.entries()) {
        await t.query('INSERT INTO shared_splits (shared_id, member_id, share) VALUES ($1,$2,$3)',
          [sid, mid, k === 0 ? round(amt - each * (ids.length - 1)) : each]);
      }
    });
    return res.json({ id: sid });
  }
  if (b.action === 'delete_expense') {
    const r = await db.run('DELETE FROM shared_expenses WHERE id=$1 AND user_id=$2', [b.id, uid(req)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true });
  }
  bad(res, 'Unknown action');
}));

// ---------------- statement import ----------------
// Flags rows that look like an expense this account already has.
async function markDuplicates(userId, list) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  const seen = new Set();   // also catches duplicates inside the file itself
  const out = [];
  for (const r of list) {
    const key = `${r.date}|${r.amount}|${norm(r.description)}`;
    const inFile = seen.has(key);
    seen.add(key);
    const near = await db.rows(
      'SELECT description FROM expenses WHERE user_id=$1 AND date=$2 AND ABS(amount - $3) < 0.005',
      [userId, r.date, r.amount]);
    const existing = near.some((e) => norm(e.description) === norm(r.description));
    out.push({ ...r, duplicate: existing || inFile });
  }
  return out;
}

app.post('/api/import/analyze', ah(async (req, res) => {
  const text = String(req.body.text || '');
  if (!text.trim()) return bad(res, 'That file looks empty');
  if (text.length > 3_000_000) return bad(res, 'That file is too large to import');

  const table = importer.parseTable(text);
  if (!table.rows.length) return bad(res, 'Could not find any rows in that file');

  const mapping = { ...importer.guessMapping(table.headers), ...(req.body.mapping || {}) };
  if (!mapping.date) return bad(res, 'Could not find a date column — pick one below');
  if (!mapping.debit && !mapping.credit && !mapping.amount) {
    return bad(res, 'Could not find an amount column — pick one below');
  }

  const categories = await db.rows('SELECT id, name FROM categories WHERE user_id = $1', [uid(req)]);
  const out = importer.normalise(table, mapping, { categories, dayFirst: req.body.dayFirst });
  const list = await markDuplicates(uid(req), out.rows);

  res.json({
    headers: table.headers,
    delimiter: table.delimiter,
    mapping,
    dayFirst: out.dayFirst,
    signedColumn: out.signedColumn,
    skipped: out.skipped,
    totalRows: table.rows.length,
    rows: list.slice(0, 500),
    truncated: list.length > 500,
  });
}));

app.post('/api/import/commit', ah(async (req, res) => {
  const list = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!list.length) return bad(res, 'Nothing selected to import');
  if (list.length > 2000) return bad(res, 'Too many rows in one import');

  const owned = new Set((await db.rows('SELECT id FROM categories WHERE user_id = $1', [uid(req)])).map((c) => c.id));
  let imported = 0;
  const errors = [];
  await db.tx(async (t) => {
    for (const [i, r] of list.entries()) {
      const desc = String(r.description || '').trim().slice(0, 200);
      const amt = Number(r.amount);
      const date = String(r.date || '');
      if (!desc || !(amt > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        errors.push(`Row ${i + 1} was skipped (missing date, amount or description)`);
        continue;
      }
      const cat = owned.has(Number(r.category_id)) ? Number(r.category_id) : null;
      await t.query('INSERT INTO expenses (user_id, description, amount, category_id, date, note) VALUES ($1,$2,$3,$4,$5,$6)',
        [uid(req), desc, round(amt), cat, date, 'imported']);
      imported++;
    }
  });

  res.json({ imported, skipped: errors.length, errors: errors.slice(0, 5) });
}));

// ---------------- insights (forecast + anomaly detection) ----------------
app.get('/api/insights', ah(async (req, res) => {
  const month = req.query.month || monthKey();
  const userId = uid(req);

  const byCategory = (await db.rows(`
    SELECT c.name, c.icon, ROUND(SUM(e.amount)::numeric, 2)::float8 AS total
    FROM expenses e JOIN categories c ON c.id = e.category_id
    WHERE e.user_id = $1 AND substr(e.date,1,7) = $2
    GROUP BY c.id, c.name, c.icon HAVING SUM(e.amount) > 0 ORDER BY total DESC
  `, [userId, month])).map((c) => ({ ...c, total: db.num(c.total) }));

  const weekly = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000);
    const d = localDate(dt);
    const s = await db.row('SELECT COALESCE(SUM(amount),0)::float8 AS s FROM expenses WHERE user_id=$1 AND date=$2', [userId, d]);
    weekly.push({ label: dt.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }), total: round(db.num(s.s)) });
  }

  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i);
    const m = localMonth(dt);
    const s = await db.row('SELECT COALESCE(SUM(amount),0)::float8 AS s FROM expenses WHERE user_id=$1 AND substr(date,1,7)=$2', [userId, m]);
    monthly.push({ label: dt.toLocaleDateString('en-US', { month: 'short' }), month: m, total: round(db.num(s.s)) });
  }

  const spentRow = await db.row('SELECT COALESCE(SUM(amount),0)::float8 AS s FROM expenses WHERE user_id=$1 AND substr(date,1,7)=$2', [userId, month]);
  const spent = round(db.num(spentRow.s));
  const budget = Number(await getSetting(userId, 'monthly_budget', '0'));
  const y = Number(month.slice(0, 4)), mo = Number(month.slice(5, 7));
  const daysInMonth = new Date(y, mo, 0).getDate();
  const isCurrent = month === monthKey();
  const daysElapsed = isCurrent ? new Date().getDate() : daysInMonth;
  const pace = spent / Math.max(1, daysElapsed);
  const projected = round(pace * daysInMonth);
  let status = 'none';
  if (budget > 0) status = projected <= budget * 0.9 ? 'on_track' : projected <= budget ? 'tight' : 'over';
  const forecast = { spent, budget, projected, days_elapsed: daysElapsed, days_in_month: daysInMonth,
    daily_avg: round(pace), over_by: round(Math.max(0, projected - budget)), status, is_current: isCurrent };

  // alerts: categories at/over limit
  const alerts = [];
  for (const c of await db.rows(`
    SELECT c.name, c.icon, c.monthly_limit AS lim,
      COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.category_id=c.id AND e.user_id=c.user_id AND substr(e.date,1,7)=$1),0)::float8 AS spent
    FROM categories c WHERE c.user_id = $2 AND c.monthly_limit > 0
  `, [month, userId])) {
    const lim = db.num(c.lim), cs = db.num(c.spent);
    const pct = lim > 0 ? cs / lim : 0;
    if (pct >= 1) alerts.push({ name: c.name, level: 'over', msg: `${c.name}: over budget (₹${Math.round(cs)} of ₹${Math.round(lim)})` });
    else if (pct >= 0.8) alerts.push({ name: c.name, level: 'warn', msg: `${c.name}: ${Math.round(pct * 100)}% of budget used` });
  }

  // anomaly detection: flag month expenses well above the category's normal (mean + 2σ, or > 2× mean)
  const unusual = [];
  for (const c of await db.rows('SELECT id,name,icon FROM categories WHERE user_id=$1', [userId])) {
    const amts = (await db.rows('SELECT amount FROM expenses WHERE category_id=$1 AND user_id=$2', [c.id, userId]))
      .map((r) => db.num(r.amount));
    if (amts.length < 3) continue;
    const mean = amts.reduce((a, b) => a + b, 0) / amts.length;
    const std = Math.sqrt(amts.reduce((s, a) => s + (a - mean) ** 2, 0) / amts.length);
    const threshold = std >= 1 ? mean + 2 * std : Infinity;
    for (const e of await db.rows('SELECT * FROM expenses WHERE category_id=$1 AND user_id=$2 AND substr(date,1,7)=$3', [c.id, userId, month])) {
      const amt = db.num(e.amount);
      if (amt > 300 && (amt > threshold || amt > mean * 2)) {
        unusual.push({ description: e.description, amount: round(amt), category: c.name, icon: c.icon,
          date: e.date, reason: `₹${Math.round(amt)} is well above your usual ${c.name} spend (about ₹${Math.round(mean)})` });
      }
    }
  }
  unusual.sort((a, b) => b.amount - a.amount);

  const cnt = await db.row('SELECT COUNT(*)::int AS c FROM expenses WHERE user_id=$1 AND substr(date,1,7)=$2', [userId, month]);
  res.json({ month, byCategory, weekly, monthly, forecast, alerts, unusual, top_category: byCategory[0] || null, count: cnt.c });
}));

// ---------------- CSV export ----------------
app.get('/api/export', ah(async (req, res) => {
  const month = req.query.month || monthKey();
  const list = await db.rows(`
    SELECT e.date, e.description, c.name AS category, e.amount, e.note
    FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.user_id = $1 AND substr(e.date,1,7) = $2 ORDER BY e.date
  `, [uid(req), month]);
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = ['Date,Description,Category,Amount,Note',
    ...list.map((r) => [r.date, r.description, r.category, r.amount, r.note].map(q).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="spendsense-${month}.csv"`);
  res.send(csv);
}));

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'views', '404.html')));

// Final error handler: anything an async route rejects with lands here.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.message);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong' });
  res.status(500).send('Something went wrong');
});

// Boot-time work, shared by the standalone server and the Netlify Function.
let initPromise = null;
function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await db.ready();
      await seed();                      // demo data on first boot (only if empty)
      await auth.purgeExpiredSessions();
    })();
  }
  return initPromise;
}

module.exports = { app, init };

if (require.main === module) {
  init()
    .then(() => app.listen(PORT, () => {
      console.log(`SpendSense running on http://localhost:${PORT}`);
      if (PROD) console.log('Running in production mode: HTTPS redirect, secure cookies and HSTS are on.');
    }))
    .catch((e) => { console.error('Startup failed:', e); process.exit(1); });
}
