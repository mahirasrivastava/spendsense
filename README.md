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
Postgres  (Netlify DB / Neon, or PGlite locally)
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
├── db.js                 # Postgres access layer (Neon in prod, PGlite locally)
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

## Deploying to Netlify

The app runs as a single Express-backed Netlify Function, with the frontend assets served from
the CDN. `netlify.toml` and `netlify/functions/api.js` are already wired up.

### 1. Put it on GitHub

```bash
gh auth login                                        # browser flow, one time
gh repo create spendsense --public --source=. --push
```
No `gh`? Create an empty repo at github.com, then:
```bash
git remote add origin https://github.com/<you>/spendsense.git
git push -u origin main
```

### 2. Deploy

Use `npx` rather than a global install. On macOS, `npm i -g` usually fails with `EACCES` because
`/usr/local/lib/node_modules` is owned by root, and installing CLIs with `sudo` is worth avoiding.

```bash
npx netlify-cli login
npx netlify-cli init             # links the GitHub repo; enables deploy-on-push
npx netlify-cli database init    # provision Netlify DB (Postgres, powered by Neon)
npx netlify-cli deploy --prod
```

`database init` is interactive and sets the Postgres connection string in the site's environment.
It also offers to scaffold a starter migration — SpendSense creates its own schema on first
request, so that scaffolding can be skipped or deleted.

`db.js` accepts `NETLIFY_DB_URL`, `NETLIFY_DATABASE_URL` or `DATABASE_URL`, so it works whichever
name the CLI sets. On first request the function creates its schema and seeds demo data, so a
fresh site needs no separate migration step.

### Bringing existing data across
If you have been using the old SQLite build, copy its contents into Postgres once:

```bash
npm install --include=dev                        # the migration needs better-sqlite3
DATABASE_URL="postgres://..." npm run migrate    # add --dry to preview
```
Get the connection string with `npx netlify-cli database connect`, or from the site's environment
variables in the Netlify dashboard.
The script copies users, categories, expenses, recurring rules, settings, members and splits,
preserving ids, then resets the Postgres sequences so new inserts cannot collide. It refuses to
run against a database that already has accounts.

### Why the stack changed
The original build used `better-sqlite3`, which cannot work on Netlify: it is a native module that
fails to load on AWS Lambda (`invalid ELF header`, `GLIBC_2.29 not found`), and function
filesystems are ephemeral, so a SQLite file would be lost between invocations. Postgres removes
both problems.

### Other hosts
`Dockerfile` and `render.yaml` still work for Render, Railway, Fly.io or a VPS. Set `DATABASE_URL`
to a managed Postgres, or leave it unset and mount a volume at `PGLITE_DIR` for the embedded
engine.

### Production hardening already in place
- HTTPS redirect and HSTS when `NODE_ENV=production`
- `Secure`, `HttpOnly`, `SameSite=Lax` session cookies
- `trust proxy` enabled so the login throttle sees real client IPs behind a load balancer
- Cross-origin mutating requests rejected by an Origin check (CSRF defence; all mutating routes are JSON-only)
- `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` headers
- Sign-up and login both rate limited per IP

### Still worth doing before real users
- The login/sign-up throttle is in-memory, so it resets between function invocations and is not
  shared across instances. Move it into Postgres if you need it to hold on serverless.
- There is no email verification, password reset or account deletion.

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
