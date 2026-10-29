# SpendSense — Student Expense & Budget Planner

Track spending, set budgets, and see where your money goes — with a **smart forecast** that
predicts whether you'll overspend and **flags unusual expenses** automatically.

Full-stack: **HTML · CSS · JavaScript · AJAX** on the frontend, **Node.js (Express)** backend,
**Postgres** database, with **account-based authentication**. Every action in the dashboard updates
the page via AJAX — no reloads.

The database layer picks itself: with `NETLIFY_DATABASE_URL` / `DATABASE_URL` set it talks to
Postgres (Netlify DB / Neon); without it, it runs **PGlite** — a real Postgres engine embedded in
the process — so local development needs no database install and no cloud account.

## How to run (2 steps)

> Requires **Node.js** (v16+). Check with `node -v`.
```bash
npm install
npm start
```
Open **http://localhost:8000**, then create an account.

The database is created and **seeded with demo data automatically** on first run. That demo
data is unassigned until someone signs up: **the first account you create adopts it**, so the
charts, forecast and lists have content right away. Every account created after that starts with a
clean slate and a default set of categories.

> Reset anytime: delete the `.pgdata/` folder, or run `npm run seed`.

## Pages
| Route | Access | What it is |
| --- | --- | --- |
| `/` | public | Landing page — hero, features, how it works, FAQ |
| `/signup` | public | Create an account |
| `/login` | public | Sign in |
| `/app` | **signed in** | The dashboard (redirects to `/login` otherwise) |

## Features
- Expense logging + categories with icons, **live search**
- Monthly **budget + savings goal**, with over-budget **alerts**
- **Charts** (Chart.js, bundled locally): category donut, last-7-days, 6-month trend
- **Recurring expenses** (rent, mess, subscriptions) — "Post due now" catches up missed months
- **Roommate splitting** — shared expenses, balances, and a simplest-way-to-settle plan
- **CSV export** of any month
- **Statement import** — drop a bank CSV in and it becomes expenses, auto-categorised
- **Smart forecast** — projects month-end spend from your pace and warns if you'll exceed budget
- **Unusual-spend detection** — flags expenses far above your normal for that category (mean + 2σ)
- **Light and dark themes**, remembered per browser
- Responsive from phone to desktop; respects `prefers-reduced-motion`

## Statement import

The **Import** tab turns a bank statement into expenses, so you don't have to type a month in by hand.

Drop a `.csv` (or paste the rows) and SpendSense will:

1. **Find the real header row**, skipping the preamble banks put at the top of exports.
2. **Detect the delimiter** — comma, semicolon, tab or pipe.
3. **Guess the columns.** Debit/credit pairs (`Withdrawal Amt.` / `Deposit Amt.`) are recognised
   before a generic `Amount` column, since labels overlap. You can override any guess.
4. **Work out the date format** — `DD/MM/YY`, `MM/DD/YYYY`, `DD-Mon-YYYY` or ISO — by checking the
   whole column for a value above 12 rather than trusting the first row.
5. **Work out direction.** Separate debit/credit columns, a `Dr`/`Cr` suffix, or signs in a single
   column (if any value is negative, positives are treated as money coming in). Incoming payments
   like salary are listed but left unticked.
6. **Suggest a category** per row from merchant keywords (Swiggy → Food, Uber → Transport,
   BigBasket → Groceries, and so on), matched against your own category names.
7. **Flag duplicates** — anything matching an existing expense on date, amount and description is
   shown greyed out and unticked, so re-importing an overlapping statement is safe.

You then review the table, adjust any category, and import. Imported rows carry the note `imported`.

Parsing happens on your own server; the file is never sent anywhere else.

> **PDF statements are not supported.** Bank PDFs are usually password-protected and every bank
> lays them out differently, so text extraction is unreliable enough that it would import wrong
> numbers. Download the CSV/Excel export from net banking instead — every major bank offers one.

### Import API
| Method | Endpoint | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/import/analyze` | `{text, mapping?, dayFirst?}` | headers, guessed mapping, normalised rows with duplicate flags |
| POST | `/api/import/commit` | `{rows:[{date, description, amount, category_id}]}` | `{imported, skipped, errors}` |

Both require a session. `commit` re-validates every row and only accepts categories the account owns.

## Authentication

Accounts are handled in `auth.js` with no extra dependencies:

- **Password hashing** — `node:crypto` **scrypt** (N=16384, r=8, p=1) with a random 16-byte salt per
  user. Verification uses `timingSafeEqual`. Passwords are never stored or logged in plain text.
- **Sessions** — a 32-byte random token is sent as an **HttpOnly, SameSite=Lax** cookie; only the
  SHA-256 **hash** of the token is stored in the `sessions` table, so a database leak does not hand
  over live sessions. Logout deletes the row, which invalidates the cookie server-side.
  Set `SECURE_COOKIES=1` when serving over HTTPS to add the `Secure` flag.
- **Login throttling** — 8 failed attempts per email+IP in 15 minutes, then `429`.
- **No account enumeration** — a wrong password and an unknown email return the same message.
- **Data isolation** — every table carrying user data has a `user_id`, and every query is scoped to
  the signed-in user. Deletes and updates match on `id AND user_id`, so one account cannot touch
  another's rows even by guessing IDs.

### Auth API
| Method | Endpoint | Body | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | `{name, email, password}` | password ≥ 8 chars; `409` if email taken |
| POST | `/api/auth/login` | `{email, password}` | `401` on bad credentials, `429` when throttled |
| POST | `/api/auth/logout` | — | deletes the session row and clears the cookie |
| GET | `/api/auth/me` | — | `{user}` or `{user: null}` |

All other `/api/*` routes require a session and return `401` without one.

## How the stack fits together (for your viva)
```
Browser (HTML + CSS + JS)
   │  fetch()  ← this is AJAX: requests data without reloading
   ▼
Node.js + Express  (server.js — the backend / API)
   │
   ▼
Postgres  (any provider, or PGlite locally)
```
- **HTML** → `views/` (page templates, served by Express)
- **CSS** → `public/assets/style.css`
- **JavaScript + AJAX** → `public/assets/app.js` (the `fetch()` calls hit the API)
- **Backend** → `server.js` (Express routes under `/api/...`)
- **Auth** → `auth.js` (hashing, sessions, route guards)
- **Database** → `db.js` (Postgres access layer)

## Structure
```
spendsense/
├── package.json
├── server.js             # Express backend: serves pages + all /api routes
├── auth.js               # password hashing, sessions, route guards
├── db.js                 # Postgres access layer (pg in prod, PGlite locally)
├── importer.js           # bank-statement parsing (pure functions, no DB access)
├── migrate-sqlite-to-postgres.js   # one-off import from the old SQLite build
├── netlify.toml          # Netlify build + routing
└── netlify/functions/api.js        # Express wrapped as a serverless function
├── seed.js               # demo data (auto on first run; `npm run seed` to reset)
├── views/                # page HTML (NOT static — protected pages are guarded)
│   ├── landing.html
│   ├── login.html
│   ├── signup.html
│   ├── app.html          # the dashboard
│   └── 404.html
└── public/assets/        # the only publicly served directory
    ├── style.css         # design system: tokens, components, light + dark
    ├── icons.js          # shared SVG icon sprite + window.icon()
    ├── site.js           # navbar, mobile menu, auth state, reveal, toasts
    ├── auth.js           # login/signup form logic
    ├── app.js            # dashboard logic + AJAX
    └── chart.min.js      # Chart.js, bundled for offline use
```

> Page HTML lives in `views/`, outside the static directory, so `/app.html` cannot be fetched
> directly to bypass the login guard.

## The "smart" bits
- **Forecast:** `projected = (spent ÷ days elapsed) × days in month`, compared to budget → on-track / tight / over.
- **Unusual spend:** per category, mean + standard deviation of past expenses; flag anything above `mean + 2×σ` (or more than 2× the average). Simple, explainable statistics.
- **Settle-up:** balances are matched largest creditor against largest debtor, producing the fewest transfers that clear everyone.
- **Import duplicate check:** a row counts as already present when an existing expense shares its date and amount and its description matches once punctuation and case are stripped. The same test also catches repeats inside one file.

## Deploying

SpendSense is a stateful Node server that stores data in Postgres, so it needs a host that runs a
long-lived process. **Render is the simplest**, because the included blueprint provisions the
database too.

### Render (recommended)

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Blueprint**, pick the repo.
3. Render reads `render.yaml`, creates the web service **and** a free Postgres database, and
   injects `DATABASE_URL` into the service automatically. Nothing to copy by hand.

On first request the app creates its schema and seeds demo data.

Two things to know about Render's free tier: the web service sleeps after inactivity (the first
request afterwards takes ~30s to wake), and free Postgres instances expire after a set period —
check Render's current policy if this needs to last.

### Any other Node host

```bash
npm install --omit=dev
DATABASE_URL="postgres://user:pass@host/db?sslmode=require" NODE_ENV=production npm start
```
TLS is driven by the connection string's `sslmode`, so certificates are verified normally. Use
`?sslmode=disable` only for an in-network database such as Render's internal host.

`Dockerfile` works the same way; without `DATABASE_URL` it falls back to embedded PGlite under
`PGLITE_DIR`, which needs a mounted volume.

### Bringing existing data across
If you used the older SQLite build:

```bash
npm install --include=dev                        # the migration needs better-sqlite3
DATABASE_URL="postgres://..." npm run migrate    # add --dry to preview
```
It copies users, categories, expenses, recurring rules, settings, members and splits, preserving
ids, then resets the Postgres sequences. It refuses to run against a database that already has
accounts.

### Why not Netlify or Vercel
Both run serverless functions with an ephemeral filesystem and no long-lived process. A function
deploy of this app works, but Netlify DB only provisioned a dev-context database on a free team,
leaving the function with no connection string at runtime. `netlify.toml` and
`netlify/functions/api.js` remain in the repo and do work if you supply `DATABASE_URL` yourself.

### Production hardening already in place
- HTTPS redirect and HSTS when `NODE_ENV=production`
- `Secure`, `HttpOnly`, `SameSite=Lax` session cookies
- `trust proxy` so the login throttle sees real client IPs behind a load balancer
- Cross-origin mutating requests rejected by an Origin check (CSRF defence; mutating routes are JSON-only)
- `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` headers
- Sign-up and login rate limited per IP

### Still worth doing before real users
- The rate limiter is in-memory, so it resets on restart and is per-instance.
- No email verification, password reset or account deletion.

## Commands
```bash
npm start        # run the app (http://localhost:8000)
npm run seed     # wipe + reload fresh demo data
npm run migrate  # copy an old spendsense.db into Postgres (--dry to preview)
```

## Not implemented
- **Live bank connection.** Pulling transactions straight from a bank in India goes through RBI's
  Account Aggregator framework, and consuming that data requires registering as a Financial
  Information User — which is only open to entities already regulated by RBI, SEBI, IRDAI or PFRDA.
  A project cannot qualify. Developer sandboxes (Finvu, Setu, OneMoney, Anumati) do exist if you
  want to demo the consent flow against mock banks. Statement import covers the same need with real
  data and no dependency.
- **PDF statements** — see the note under Statement import.
- **Password reset / "forgot password"** — this needs an email delivery mechanism, which the project
  has no backend for. Rather than ship a link that goes nowhere, it is left out. Adding it would
  require a `password_resets` table (token hash, user_id, expires_at), two endpoints to request and
  consume a token, and an SMTP integration.
