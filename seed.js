// seed.js — demo data. Auto-runs on first boot (only if empty).
// Rows are written with user_id NULL; the first account to sign up claims them
// (see seedNewUser in auth.js), so the demo content lands in a real account.
// Run directly to force a fresh reseed:  npm run seed
const db = require('./db');

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));

async function seed({ force = false } = {}) {
  await db.ready();
  const existing = Number((await db.row('SELECT COUNT(*)::int AS c FROM categories')).c);
  if (existing > 0 && !force) return;

  if (force) {
    await db.tx(async (t) => {
      for (const table of ['shared_splits', 'shared_expenses', 'members', 'recurring',
                           'settings', 'expenses', 'categories']) {
        await t.query(`DELETE FROM ${table}`);
      }
    });
  }

  const cats = [
    ['Food', 'utensils', 4000], ['Transport', 'bus', 1500], ['Groceries', 'shopping-cart', 3000],
    ['Entertainment', 'film', 1200], ['Education', 'book', 2000], ['Shopping', 'shopping-bag', 2500],
    ['Bills', 'lightbulb', 2000], ['Other', 'package', 1000],
  ];
  const catId = {};
  for (const [name, icon, limit] of cats) {
    const r = await db.row(
      'INSERT INTO categories (user_id, name, icon, monthly_limit) VALUES (NULL,$1,$2,$3) RETURNING id',
      [name, icon, limit]);
    catId[name] = r.id;
  }

  await db.run('INSERT INTO settings (user_id, key, value) VALUES (NULL,$1,$2)', ['monthly_budget', '12000']);
  await db.run('INSERT INTO settings (user_id, key, value) VALUES (NULL,$1,$2)', ['savings_goal', '2000']);

  const samples = [
    ['Canteen lunch', 120, 'Food', 2], ['Chai & snacks', 60, 'Food', 1],
    ['Dominos with friends', 650, 'Food', 3], ['Bus pass top-up', 300, 'Transport', 4],
    ['Auto to station', 90, 'Transport', 2], ['Groceries run', 850, 'Groceries', 6],
    ['Movie ticket', 250, 'Entertainment', 5], ['Netflix share', 150, 'Entertainment', 8],
    ['Notebook & pens', 220, 'Education', 7], ['Online course', 999, 'Education', 20],
    ['New earphones', 1299, 'Shopping', 12], ['T-shirt', 599, 'Shopping', 25],
    ['Electricity share', 600, 'Bills', 10], ['Mobile recharge', 299, 'Bills', 15],
    ['Dinner out', 480, 'Food', 9], ['Coffee', 180, 'Food', 0],
    ['Cab (late night)', 240, 'Transport', 11], ['Snacks for hostel', 320, 'Groceries', 14],
    ['Concert ticket', 1500, 'Entertainment', 1],
    ['Stationery', 140, 'Education', 30], ['Groceries', 720, 'Groceries', 35],
    ['Lunch', 110, 'Food', 40], ['Bus', 80, 'Transport', 45],
    ['Birthday gift', 900, 'Shopping', 50], ['Dinner', 380, 'Food', 55],
    ['Groceries', 640, 'Groceries', 62], ['Data pack', 249, 'Bills', 68],
  ];
  await db.tx(async (t) => {
    for (const [desc, amt, cat, ago] of samples) {
      await t.query(
        'INSERT INTO expenses (user_id, description, amount, category_id, date, note) VALUES (NULL,$1,$2,$3,$4,$5)',
        [desc, amt, catId[cat], daysAgo(ago), '']);
    }
  });

  const firstOfMonth = iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  await db.run('INSERT INTO recurring (user_id, description, amount, category_id, period, next_date) VALUES (NULL,$1,$2,$3,$4,$5)',
    ['Hostel mess fee', 3500, catId['Food'], 'monthly', firstOfMonth]);
  await db.run('INSERT INTO recurring (user_id, description, amount, category_id, period, next_date) VALUES (NULL,$1,$2,$3,$4,$5)',
    ['Gym membership', 700, catId['Other'], 'monthly', firstOfMonth]);

  const mids = [];
  for (const n of ['Me', 'Aditya', 'Sara']) {
    const r = await db.row('INSERT INTO members (user_id, name) VALUES (NULL,$1) RETURNING id', [n]);
    mids.push(r.id);
  }
  const sid = (await db.row(
    'INSERT INTO shared_expenses (user_id, description, amount, paid_by, date) VALUES (NULL,$1,$2,$3,$4) RETURNING id',
    ['Pizza night', 900, mids[0], daysAgo(3)])).id;
  const each = Math.round((900 / mids.length) * 100) / 100;
  for (const [i, m] of mids.entries()) {
    await db.run('INSERT INTO shared_splits (shared_id, member_id, share) VALUES ($1,$2,$3)',
      [sid, m, i === 0 ? Math.round((900 - each * (mids.length - 1)) * 100) / 100 : each]);
  }

  console.log('Seeded SpendSense demo data.');
}

module.exports = seed;

if (require.main === module) {
  seed({ force: true })
    .then(() => { console.log('Reseed complete.'); process.exit(0); })
    .catch((e) => { console.error('Reseed failed:', e.message); process.exit(1); });
}
