# OrderInn — Production Readiness Audit

_Audited 2026-07-11 against the live `main` branch. Findings are grounded in
the actual code, not a generic checklist._

## TL;DR

The app is **feature-rich and well-built on the front end**, but it is **not
safe to run as a real business yet** because of one structural problem: the
database is effectively public and the admin login is fake (client-side). Fix
that first; almost everything else is polish.

Severity legend: 🔴 blocker · 🟠 important · 🟡 nice-to-have

---

## 🔴 P0 — Security blockers (must fix before real customers/money)

### 1. The live database is wide open
`data/supabase.sql` (the policies that are actually applied — `supabase-harden.sql`
is **not** applied, see below) grants:
- `bb_products`, `bb_config`, `bb_orders`: `for all using (true)` — anyone can
  read, insert, update, **delete**.
- `bb_accounts`: `for select using (true)` — and this table stores
  `password_hash`.

The anon key is committed in `config.js` (which is fine by design), but combined
with these policies, anyone who opens the site can hit the Supabase REST endpoint
directly and:
- Dump every account's email + password hash.
- Change any product's price to ₱0, delete all orders, rewrite the config.
- Insert fake orders / tamper with anyone's order.

### 2. Passwords are weakly hashed
`store.js` hashes with **plain SHA-256 + a single hardcoded pepper**
(`bossb_local_pepper_change_when_wiring_real_backend`), **no per-user salt**.
Once the hashes leak (see #1), they're cheaply crackable with rainbow
tables / GPU. The pepper is in the committed source, so it adds nothing.

### 3. The admin session is forgeable
`Store.login()` compares the hash **client-side** and then writes a plain JSON
`{role:'admin', expiresAt}` blob to localStorage. There is no server check.
Anyone can paste an admin session into localStorage and unlock the admin panel.
RLS doesn't stop them because (per #1) writes are open to anon anyway.

**The fix (single track, in order):**
1. Migrate admin auth to **Supabase Auth** — replace `Store.login()` with
   `sb.auth.signInWithPassword()`, gate the admin panel on
   `sb.auth.getSession()`. (Already scoped in `supabase-harden.sql`'s footer and
   the `orderinn-next-phase-supabase-auth` note.)
2. Move customer accounts to Supabase Auth too (or at minimum stop shipping
   `password_hash` to the client — a `SECURITY DEFINER` RPC that verifies server-side).
3. **Then** apply `supabase-harden.sql` (it's safe only after step 1 — applying
   it now locks the admin panel out because no `authenticated` role exists yet).
4. Drop `password_hash` from `bb_accounts` entirely once Auth owns credentials.

---

## 🟠 P1 — Important (needed for a trustworthy launch)

### 4. Order totals are trusted from the client
Prices and totals are computed in the browser and written to `bb_orders`. With
open RLS, a customer can place an order at any price they like. Even after RLS
is fixed, the **server should recompute the total** from product IDs — either a
Postgres trigger/RPC that prices the order, or an edge function.

### 5. No server-side input validation
All validation is client-side (min password length, required fields, etc.). A
direct API call bypasses all of it. Needs `CHECK` constraints and/or RPC
validation once Auth is in.

### 6. No error tracking or observability
No Sentry/Bugsnag. If a customer hits a JS error mid-order, you'll never know.
Add a lightweight error reporter (Sentry free tier) before launch.

### 7. No security headers
No `_headers` / `netlify.toml`. Missing CSP, `X-Frame-Options`,
`Referrer-Policy`, HSTS. A CSP would also be a second line of defense for the
XSS surface (#10).

### 8. Supabase free-tier fragility
The keep-alive workflow (`.github/workflows/keep-alive.yml`) papers over the
free-tier pause, but a real business needs the paid tier (guaranteed uptime,
backups, no cold-start). Also confirm **point-in-time backups** are on.

---

## 🟡 P2 — Quality / maintainability (post-launch)

### 9. No tests, no build, no CI
No `package.json`, no test suite, ~5,400-line `script.js` +
2,200-line `store.js`. A few smoke/e2e tests (Playwright) around the critical
flows — place order, cancel, admin status change, login — would catch
regressions. CI to run them on push.

### 10. XSS surface (currently OK, keep it that way)
43 `escapeHtml` guards cover the user-content renders I sampled; the unescaped
`innerHTML` writes are static strings. This is **fine today** but fragile at
5.4k lines — one forgotten `escapeHtml` on a customer name / order note is a
stored-XSS hole. A CSP (#7) is the safety net.

### 11. Large monolithic files
`script.js` (5.4k lines) and `style.css` (3.7k lines) are single files. Not
urgent, but splitting by feature (or adding a light build step) would help
future work. Cache-busting is currently manual (`?v=67`).

### 12. Codebase still carries `bossb` identifiers
Intentional (per the `orderinn-rebrand-functional-identifiers` note — PEPPER,
admin email, localStorage keys left to avoid breaking the live app). The Auth
migration is the natural time to finish the rename cleanly.

---

## Suggested order of work

1. **Supabase Auth migration** (admin first, then customer) — unblocks everything.
2. **Apply `supabase-harden.sql`** + drop `password_hash`.
3. **Server-side order pricing/validation** (RPC or trigger).
4. **Security headers + error tracking + paid tier/backups.**
5. **Smoke tests + CI.**
6. Cleanup: finish rename, split files, automate cache-busting.

Items 1–3 are the real "production ready" line. 4–6 make it maintainable and
observable.
