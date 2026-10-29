// importer.js — turns a raw bank statement (CSV / delimited text) into
// normalised expense rows. Pure functions, no database access, so it can be
// tested on its own.

/* ---------------- delimited-text parsing ---------------- */

// Splits one line, honouring "quoted, fields" and "" escapes.
function splitLine(line, delim) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function detectDelimiter(lines) {
  const candidates = [',', ';', '\t', '|'];
  let best = ',', bestScore = -1;
  for (const d of candidates) {
    const counts = lines.slice(0, 30).map((l) => splitLine(l, d).length);
    const max = Math.max(...counts, 0);
    if (max < 2) continue;
    // prefer the delimiter that yields the most columns, consistently
    const consistent = counts.filter((c) => c === max).length;
    const score = max * 10 + consistent;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

// Bank exports often carry preamble lines ("Statement of account", blanks, etc.)
// before the real header. The header is the first line that splits into the
// most columns and looks like labels rather than data.
function parseTable(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return { headers: [], rows: [], delimiter: ',' };

  const delimiter = detectDelimiter(lines);
  const split = lines.map((l) => splitLine(l, delimiter));
  const width = Math.max(...split.map((r) => r.length));

  let headerIdx = split.findIndex((r) => {
    if (r.length < Math.max(2, width - 1)) return false;
    const filled = r.filter((c) => c !== '');
    if (filled.length < 2) return false;
    // header cells are words, not numbers or dates
    return filled.every((c) => !/^[\d.,/\-₹()]+$/.test(c)) && filled.some((c) => /[a-z]/i.test(c));
  });
  if (headerIdx === -1) headerIdx = 0;

  const headers = split[headerIdx].map((h, i) => h || `Column ${i + 1}`);
  const rows = split.slice(headerIdx + 1)
    .filter((r) => r.some((c) => c !== ''))
    .map((r) => {
      const o = {};
      headers.forEach((h, i) => { o[h] = r[i] ?? ''; });
      return o;
    });
  return { headers, rows, delimiter };
}

/* ---------------- column guessing ---------------- */
const RE = {
  date: /^(txn|transaction|value|posting|book(ing)?)?\s*(date|dt)\.?$|date/i,
  desc: /narration|description|particulars|remarks|details|transaction|merchant|payee|name/i,
  debit: /withdraw|debit|\bdr\b|paid\s*out|money\s*out|spent/i,
  credit: /deposit|credit|\bcr\b|paid\s*in|money\s*in|received/i,
  balance: /balance|\bbal\b/i,
  amount: /amount|\bamt\b|value/i,
};

function guessMapping(headers) {
  const find = (re, exclude = []) => headers.find((h) =>
    re.test(h) && !exclude.some((e) => e.test(h))) || null;

  const date = find(RE.date);
  const description = find(RE.desc, [RE.date]);
  // debit/credit must be checked before the generic amount column, because
  // labels like "Withdrawal Amt." match both
  const debit = find(RE.debit, [RE.balance]);
  const credit = find(RE.credit, [RE.balance]);
  const amount = (debit && credit) ? null : find(RE.amount, [RE.balance, RE.debit, RE.credit]);

  return { date, description, debit, credit, amount };
}

/* ---------------- dates ---------------- */
const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };
const pad = (n) => String(n).padStart(2, '0');

// Returns {a, b, y} pieces plus whether the month position is already known.
function dateParts(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);       // 2026-10-29
  if (m) return { y: +m[1], mo: +m[2], d: +m[3], certain: true };

  m = s.match(/^(\d{1,2})[-/.\s]([a-z]{3,9})[-/.\s](\d{2,4})/i);  // 05-Jan-26
  if (m && MONTHS[m[2].toLowerCase().slice(0, 4)] !== undefined || (m && MONTHS[m[2].toLowerCase().slice(0, 3)])) {
    const key = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (key) return { y: normYear(+m[3]), mo: key, d: +m[1], certain: true };
  }

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);          // 29/10/2026 or 10/29/2026
  if (m) return { a: +m[1], b: +m[2], y: normYear(+m[3]), certain: false };

  return null;
}
const normYear = (y) => (y < 100 ? (y > 70 ? 1900 + y : 2000 + y) : y);

// Decides day-first vs month-first by looking at the whole column.
function detectDayFirst(values) {
  let dayFirst = true, evidence = 0;
  for (const v of values) {
    const p = dateParts(v);
    if (!p || p.certain) continue;
    if (p.a > 12 && p.b <= 12) { dayFirst = true; evidence++; }
    else if (p.b > 12 && p.a <= 12) { dayFirst = false; evidence++; }
  }
  return { dayFirst, evidence };   // defaults to day-first (the Indian convention)
}

function toISODate(raw, dayFirst = true) {
  const p = dateParts(raw);
  if (!p) return null;
  const d = p.certain ? p.d : (dayFirst ? p.a : p.b);
  const mo = p.certain ? p.mo : (dayFirst ? p.b : p.a);
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  return `${p.y}-${pad(mo)}-${pad(d)}`;
}

/* ---------------- amounts ---------------- */
function toAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\bdr\b|debit/i.test(s)) neg = true;
  const cr = /\bcr\b|credit/i.test(s);
  s = s.replace(/[₹$€£,\s]/g, '').replace(/(dr|cr|debit|credit)\.?/gi, '');
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return { value: n, negative: neg, credit: cr };
}

/* ---------------- categorisation ---------------- */
// Keyword -> category name. Matched against the account's own category names,
// so a user who renamed or deleted categories still gets sensible results.
const RULES = [
  [/swiggy|zomato|restaurant|cafe|coffee|starbucks|dominos|pizza|mcdonald|kfc|burger|canteen|mess|eat|food|bakery|barbeque|biryani/i, 'Food'],
  [/uber|ola|rapido|irctc|railway|metro|petrol|fuel|hpcl|iocl|bpcl|shell|parking|toll|fastag|bus|cab|taxi|flight|indigo|spicejet/i, 'Transport'],
  [/bigbasket|blinkit|zepto|instamart|dmart|grocer|supermarket|reliance fresh|more retail|spencer|kirana|vegetable/i, 'Groceries'],
  [/netflix|spotify|prime video|hotstar|jiocinema|bookmyshow|pvr|inox|cinema|movie|game|steam|playstation|youtube premium/i, 'Entertainment'],
  [/udemy|coursera|unacademy|byju|vedantu|tuition|college|school|exam|book|stationery|library|course|fees/i, 'Education'],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|shop|store|mall|decathlon|zara|h&m|lifestyle|croma|reliance digital/i, 'Shopping'],
  [/electricity|water bill|gas bill|broadband|wifi|airtel|jio|vodafone|\bvi\b|bsnl|recharge|dth|tata power|adani|mobile bill|rent/i, 'Bills'],
  [/gym|fitness|cult|decathlon|yoga|sport/i, 'Other'],
  [/pharmacy|apollo|medical|hospital|clinic|doctor|medicine|1mg|pharmeasy/i, 'Other'],
];

function suggestCategory(description, categories) {
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  // an exact category-name mention always wins
  for (const c of categories) {
    if (new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(description)) return c.id;
  }
  for (const [re, name] of RULES) {
    if (re.test(description)) {
      const id = byName.get(name.toLowerCase());
      if (id) return id;
    }
  }
  return byName.get('other') ?? null;
}

/* ---------------- row normalisation ---------------- */
function cleanDescription(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^(upi|neft|imps|rtgs|pos|atw|ach|nach|mmt)[-/\s]+/i, '')
    .replace(/[-/]\d{6,}.*$/, '')          // trailing reference numbers
    .trim()
    .slice(0, 120) || 'Bank transaction';
}

// Builds normalised rows. `direction` is 'debit' (spending) or 'credit'.
function normalise(table, mapping, opts = {}) {
  const { categories = [], dayFirst } = opts;
  const dateVals = table.rows.map((r) => r[mapping.date]);
  const df = dayFirst !== undefined ? dayFirst : detectDayFirst(dateVals).dayFirst;

  // If a single amount column carries any negatives, the export is using signs
  // to mean direction, so positives are money coming in.
  const signedColumn = !mapping.debit && !mapping.credit && mapping.amount
    ? table.rows.some((r) => { const a = toAmount(r[mapping.amount]); return a && a.negative; })
    : false;

  const rows = [];
  const skipped = { noDate: 0, noAmount: 0 };

  for (const r of table.rows) {
    const date = toISODate(r[mapping.date], df);
    if (!date) { skipped.noDate++; continue; }

    let value = null, direction = 'debit';
    if (mapping.debit || mapping.credit) {
      const d = mapping.debit ? toAmount(r[mapping.debit]) : null;
      const c = mapping.credit ? toAmount(r[mapping.credit]) : null;
      if (d && d.value > 0) { value = d.value; direction = 'debit'; }
      else if (c && c.value > 0) { value = c.value; direction = 'credit'; }
    } else if (mapping.amount) {
      const a = toAmount(r[mapping.amount]);
      if (a && a.value > 0) {
        value = a.value;
        if (a.credit) direction = 'credit';
        else if (a.negative) direction = 'debit';
        else direction = signedColumn ? 'credit' : 'debit';
      }
    }
    if (value == null) { skipped.noAmount++; continue; }

    const description = cleanDescription(r[mapping.description]);
    rows.push({
      date,
      description,
      amount: Math.round(value * 100) / 100,
      direction,
      category_id: direction === 'debit' ? suggestCategory(description, categories) : null,
    });
  }
  return { rows, dayFirst: df, skipped, signedColumn };
}

module.exports = {
  parseTable, guessMapping, normalise, toISODate, toAmount,
  detectDayFirst, cleanDescription, suggestCategory, splitLine, detectDelimiter,
};
