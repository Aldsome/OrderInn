/* ==========================================================
   ORDERINN COFFEE — DATA STORE
   ----------------------------------------------------------
   Single-file SPA. Customer ordering + admin panel both live
   inside index.html. Data lives in localStorage; swap for a
   real backend at the marked TODOs.

   Keys:
     bb_menu      — array of menu items
     bb_orders    — array of placed orders
     bb_config    — shop name + currency + table count
     bb_users     — admin accounts (no customer accounts here)
     bb_session   — current admin session

   Default admin: admin@orderinn.com / admin1234
   ========================================================== */

const STORE_KEYS = {
  menu:           'bb_menu',
  orders:         'bb_orders',
  config:         'bb_config',
  users:          'bb_users',
  session:        'bb_session',
  client:         'bb_client_id',       // per-browser anonymous id, lets us track
                                          // "my orders" for the customer without accounts
  clientHistory:  'bb_client_id_history', // capped list of this browser's PAST client ids.
                                          // "Is this mine?" checks consult current + history
                                          // so a soft reset (visit-end, inactivity, login/out)
                                          // doesn't make the same device look like a new person
                                          // or flip its own chat ownership.
  log:            'bb_activity_log',    // admin-facing changelog (last 50 entries)
  logSeen:        'bb_log_seen',        // last activity id the admin has seen
  sessionTable:   'bb_session_table',   // { name, ts, clientId } — 24h guest persistence
  activeSessions: 'bb_active_sessions', // { [clientId]: { name, lastActive } } — collision check
  pendingWrites:  'bb_pending_writes',  // queue of remote writes that haven't been flushed yet
  customer:       'bb_customer',        // signed-in customer profile { id, email, name }
  cartSession:    'bb_cart_session',    // { sessionId, restaurantId, cartItems, createdAt, expiresAt }
  favorites:      'bb_favorites',       // array of favorited product ids (per-device, no login)
};

/* Single-restaurant deployment id — scopes the cart session so the same
   browser used across different OrderInn deployments wouldn't share a
   cart. (One value today; kept explicit for the QR/kiosk model.) */
const RESTAURANT_ID = 'orderinn';

/* Absolute URL to index.html in the CURRENT deployment, whatever the
   host or base path. window.location.origin drops the path, so
   `origin + '/index.html'` breaks when the app is served from a
   subpath (e.g. GitHub Pages at /OrderInn/). Deriving it from the
   current document's directory works everywhere — root or subpath,
   localhost or live — so the Google OAuth + password-reset redirects
   land back on the real app instead of 404ing.
   Pass extra query with `q`, e.g. appUrl('index.html', 'staffOAuth=1'). */
function appUrl(page = 'index.html', q = '') {
  const dir = window.location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  return dir + page + (q ? (q[0] === '?' ? q : '?' + q) : '');
}
/* Cart session lifetime — the cart persists across refreshes and QR
   re-scans, and only resets after this much inactivity. */
const CART_SESSION_TTL_MS = 18 * 60 * 60 * 1000;   // 18h

/* How long a guest's name/table choice survives a refresh. After
   this window expires, the table prompt re-asks (so a different
   person at the same device picks their own name). Inactivity
   reset can also clear it earlier. */
const SESSION_TABLE_TTL_MS = 24 * 60 * 60 * 1000;
/* How recently another device must have been active for its name
   to count as a "live conflict" — prevents two people typing the
   same label at the same time, even before either has ordered. */
const ACTIVE_SESSION_TTL_MS = 30 * 60 * 1000;

/* Customer self-cancel rule: a customer can cancel their own
   order any time it is still `pending` — i.e. until staff start
   it by marking it `preparing`. No time limit. Once it's
   preparing/served, only staff can cancel. */

/* Combined cap for chat media (images + voice notes) stored
   inline in bb_messages. ~10% of the Supabase free DB (500 MB).
   When exceeded, the OLDEST media messages are deleted until
   back under the cap. */
const MEDIA_CAP_BYTES = 50 * 1024 * 1024;

/* ==========================================================
   DEFAULTS
   ========================================================== */
const DEFAULT_CONFIG = {
  shopName:    'OrderInn Coffee',
  tagline:     'Freshly brewed, locally loved.',
  currency:    '₱',
  tables:      12,
  /* Receipts + daily reports — admin-editable in Settings.
     taxInclusive = true means item prices already include VAT
     (typical PH retail behavior). When false, tax is added on
     top at receipt/CSV time. */
  taxRate:     12,             // percent
  taxInclusive:true,
  taxLabel:    'VAT',
  /* Chat: when false (default), guests can only message staff — a
     tablemate's messages are hidden from other guests and don't drive
     their presence/typing. Admins always see the full thread. Flip on
     in Settings to allow open guest-to-guest table chat. */
  allowGuestChat: false,
  businessName:'OrderInn Coffee',
  businessAddr:'123 Sample St, Quezon City',
  businessTin: '',             // PH BIR Tax Identification Number
  /* Lifetime order tally — daily order numbers reset to #1, so
     this monotonic counter (synced via bb_config) is how the CSV
     reports "orders since opening". */
  lifetimeOrders: 0,
  /* Menu categories — data-driven so admins can add their own
     instead of being stuck with the original hardcoded set. Each
     entry is { id, label }. Menu items reference a category by its
     id. Rides the same bb_config sync path as the rest of settings,
     so a new category appears on every device. */
  categories: [
    { id: 'coffee', label: 'Coffee' },
    { id: 'tea',    label: 'Tea' },
    { id: 'cold',   label: 'Cold' },
    { id: 'pastry', label: 'Pastries' },
  ],
  /* Custom option groups — admin-defined choices beyond the four
     built-ins (size / temp / milk / sugar), so the per-item options
     aren't limited to that set. Each group:
       { id, label, choices: [ { id, label, delta } ] }
     A menu item opts into a group via item.options[groupId] = true,
     exactly like the built-ins. Rides the bb_config sync path. */
  optionGroups: [],
};

/* Curated product photography. loremflickr's keyword lottery was
   returning off-topic shots (a pink matcha box for "matcha", cookies
   for "iced caramel"), which looks broken to a customer. Each product
   now points at a HAND-PICKED, verified Unsplash photo so the image
   always matches the item and reads like a real café's menu shot.
   photo() builds a stable, sized Unsplash CDN URL from a photo id. */
const photo = (id, w = 600, h = 420) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&crop=entropy&q=80`;

const DEFAULT_MENU = [
  { id: 'c1', name: 'Classic Espresso',  category: 'coffee', price: 90,  emoji: '☕',
    desc: 'Bold double shot, rich crema.', tag: 'Bestseller',
    img: photo('1510707577719-ae7c14805e3a'),
    options: { size: true, temp: false, milk: false, sugar: true } },
  { id: 'c2', name: 'Caramel Macchiato', category: 'coffee', price: 130, emoji: '☕',
    desc: 'Vanilla, caramel, layered milk.',
    img: photo('1572442388796-11668a67e53d'),
    options: { size: true, temp: true, milk: true, sugar: true } },
  { id: 'c3', name: 'Cafe Latte',        category: 'coffee', price: 120, emoji: '☕',
    desc: 'Smooth espresso with steamed milk.',
    img: photo('1503481766315-7a586b20f66d'),
    options: { size: true, temp: true, milk: true, sugar: true } },
  { id: 'c4', name: 'Spanish Latte',     category: 'coffee', price: 135, emoji: '☕',
    desc: 'Condensed milk + espresso.',
    img: photo('1541167760496-1628856ab772'),
    options: { size: true, temp: true, milk: true, sugar: true } },

  { id: 't1', name: 'Matcha Latte',      category: 'tea',    price: 140, emoji: '🍵',
    desc: 'Ceremonial matcha, vanilla cream.', tag: 'New',
    img: photo('1536256263959-770b48d82b0a'),
    options: { size: true, temp: true, milk: true, sugar: true } },
  { id: 't2', name: 'Jasmine Green',     category: 'tea',    price: 100, emoji: '🍵',
    desc: 'Hand-picked jasmine blossoms.',
    img: photo('1627435601361-ec25f5b1d0e5'),
    options: { size: true, temp: true, milk: false, sugar: true } },

  { id: 'b1', name: 'Cold Brew',         category: 'cold',   price: 130, emoji: '🧊',
    desc: '12-hour steep, smooth.',
    img: photo('1517701550927-30cf4ba1dba5'),
    options: { size: true, temp: false, milk: true, sugar: true } },
  { id: 'b2', name: 'Iced Caramel',      category: 'cold',   price: 145, emoji: '🧊',
    desc: 'Iced espresso with caramel.',
    img: photo('1517701550927-30cf4ba1dba5', 601, 421),
    options: { size: true, temp: false, milk: true, sugar: true } },

  { id: 'p1', name: 'Butter Croissant',  category: 'pastry', price: 75,  emoji: '🥐',
    desc: 'Flaky, golden, baked daily.',
    img: photo('1555507036-ab1f4038808a'),
    options: { size: false, temp: false, milk: false, sugar: false } },
  { id: 'p2', name: 'Chocolate Cookie',  category: 'pastry', price: 55,  emoji: '🍪',
    desc: 'Gooey center, sea-salt finish.',
    img: photo('1499636136210-6f4ee915583e'),
    options: { size: false, temp: false, milk: false, sugar: false } },
  { id: 'p3', name: 'Strawberry Tart',   category: 'pastry', price: 110, emoji: '🍰',
    desc: 'Vanilla custard, fresh berries.',
    img: photo('1565958011703-44f9829ba187'),
    options: { size: false, temp: false, milk: false, sugar: false } },
];

/* ==========================================================
   PASSWORD HASHING (prototype-only — see Required.txt)
   ========================================================== */
const PEPPER = 'bossb_local_pepper_change_when_wiring_real_backend';

async function hashPassword(plain) {
  const enc = new TextEncoder().encode(plain + PEPPER);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ==========================================================
   PASSWORD SHOW/HIDE
   Adds an inline "Show"/"Hide" text toggle INSIDE every password
   field (right edge), on every page that loads store.js. Styles are
   inlined so no stylesheet/cache bump is needed. Idempotent.
   ========================================================== */
function enhancePasswordFields(root) {
  const scope = root || document;
  scope.querySelectorAll('input[type="password"]').forEach(inp => {
    if (inp.dataset.pwEnhanced) return;
    inp.dataset.pwEnhanced = '1';

    const wrap = document.createElement('span');
    wrap.style.position = 'relative';
    wrap.style.display  = 'block';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    inp.style.paddingRight = '56px';   // room for the toggle text

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Show';
    btn.setAttribute('aria-label', 'Show password');
    Object.assign(btn.style, {
      position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
      border: 'none', background: 'transparent', color: '#B5652F',
      font: 'inherit', fontSize: '12px', fontWeight: '700',
      cursor: 'pointer', padding: '2px 4px', lineHeight: '1',
    });
    btn.addEventListener('click', () => {
      const hidden = inp.type === 'password';
      inp.type = hidden ? 'text' : 'password';
      btn.textContent = hidden ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
    });
    wrap.appendChild(btn);
  });
}
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => enhancePasswordFields());
}

/* ==========================================================
   LOCAL HELPERS
   ========================================================== */
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn(`[Store] corrupted ${key}`, e);
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error(`[Store] write failed ${key}`, e);
    return false;
  }
}

/* Best-effort fetch of a seed JSON file from disk. Returns null
   if the file is missing or the page is opened via file:// (where
   fetch is blocked by some browsers). Callers fall back to the
   in-code DEFAULT_* constants in that case. */
async function fetchJsonFile(path) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`[Store] could not load ${path}, using built-in defaults`, e);
    return null;
  }
}

/* ==========================================================
   SUPABASE BACKEND  (cross-device realtime mirror)
   ----------------------------------------------------------
   Strategy: localStorage stays the synchronous source of
   truth that the rest of the app reads from. When remote mode
   is on, writes also hit Supabase (fire-and-forget) and a
   realtime subscription patches localStorage back when other
   devices write. The synchronous Store API never changes.
   ========================================================== */
const BB_CFG = (typeof window !== 'undefined' && window.BB_CONFIG) || {};
const SUPABASE_URL = String(BB_CFG.SUPABASE_URL || '')
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/, '');   // tolerate the common copy-paste mistake
const SUPABASE_KEY = String(BB_CFG.SUPABASE_ANON_KEY || '');
const REMOTE_MODE = !!(SUPABASE_URL && SUPABASE_KEY && typeof window !== 'undefined' && window.supabase);
/* Named `sb` rather than `supabase` because the UMD bundle from
   the CDN already binds `window.supabase` to the SDK namespace;
   declaring a top-level `const supabase` would collide with it. */
const sb = REMOTE_MODE ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
}) : null;

if (REMOTE_MODE) console.info('[Store] Supabase REMOTE mode enabled →', SUPABASE_URL);
else             console.info('[Store] LOCAL mode (no Supabase URL in config.js — cross-device sync disabled)');

/* Query param carried through the Google redirect round-trip so
   resumeAuthSession() can tell "this OAuth callback was a staff
   sign-in" apart from a customer one — both land on index.html with
   the same kind of Supabase session. Encoded directly in the
   redirectTo URL (not sessionStorage/localStorage): Supabase's OAuth
   flow bounces the browser through accounts.google.com and Supabase's
   own callback domain before landing back here, and some browsers
   (Safari ITP, Firefox strict tracking protection, Brave) partition
   or clear tab/site storage across that kind of cross-site redirect
   chain — which is exactly what caused staff Google sign-ins to be
   silently treated as customer sign-ins (the flag never survived the
   round-trip). A URL query param has no such failure mode: Supabase
   preserves redirectTo's own query string verbatim and just appends
   its own `?code=` alongside it. */
const STAFF_OAUTH_PARAM = 'staffAuth';

/* Row ↔ JS object mapping. Postgres tables use snake_case;
   the in-memory app uses camelCase, mirroring the JSON file
   shape. Centralised here so the rest of the store doesn't
   need to know about either side. */
const ROW_TO_ORDER = (r) => r && ({
  id:          r.id,
  number:      r.number,
  // The legacy `table_number` column now carries the OPTIONAL free-text
  // location identifier ("Table 12", "Near window", …) or null — no
  // table is ever requested during ordering.
  locationIdentifier: r.table_number || null,
  clientId:    r.client_id,           // device/session that placed it
  userId:      r.user_id || null,     // account owner once linked (self-heals)
  items:       r.items,
  total:       Number(r.total),
  notes:       r.notes || '',
  status:      r.status,
  placedAt:    r.placed_at,
  servedAt:    r.served_at,
  cancelledAt: r.cancelled_at,
  cancelledBy: r.cancelled_by,
});
const ORDER_TO_ROW = (o) => ({
  id:           o.id,
  number:       o.number,
  table_number: o.locationIdentifier || null,   // reused column (see above)
  client_id:    o.clientId,
  user_id:      o.userId || null,               // dropped via self-heal if column absent
  items:        o.items,
  total:        o.total,
  notes:        o.notes || '',
  status:       o.status,
  placed_at:    o.placedAt,
  served_at:    o.servedAt,
  cancelled_at: o.cancelledAt || null,
  cancelled_by: o.cancelledBy || null,
});
const ROW_TO_PRODUCT = (r) => r && ({
  id:       r.id,
  name:     r.name,
  category: r.category,
  price:    Number(r.price),
  emoji:    r.emoji,
  desc:     r.description,
  tag:      r.tag || undefined,
  img:      r.img || '',
  options:  r.options || {},
});
const PRODUCT_TO_ROW = (p) => ({
  id:          p.id,
  name:        p.name,
  category:    p.category,
  price:       p.price,
  emoji:       p.emoji,
  description: p.desc,
  tag:         p.tag || null,
  img:         p.img || '',
  options:     p.options || {},
  updated_at:  new Date().toISOString(),
});
const ROW_TO_USER = (r) => r && ({
  id:           r.id,
  email:        r.email,
  name:         r.name,
  role:         r.role,
  passwordHash: r.password_hash,
  createdAt:    r.created_at,
  perks:        r.perks || null,        // jsonb: customer points/vouchers/loyalty
  authUserId:   r.auth_user_id || null, // links to auth.users once on Supabase Auth
  deletionRequestedAt: r.deletion_requested_at || null, // set = 15-day grace period running
});
const USER_TO_ROW = (u) => ({
  id:            u.id,
  email:         u.email,
  name:          u.name,
  role:          u.role,
  password_hash: u.passwordHash || null,  // null for Supabase-Auth customers
  created_at:    u.createdAt,
  perks:         u.perks || null,       // self-heals if the column isn't migrated yet
  auth_user_id:  u.authUserId || null,  // self-heals if the column isn't migrated yet
  deletion_requested_at: u.deletionRequestedAt || null, // self-heals if the column isn't migrated yet
});
/* Normalize a Postgres timestamptz into a value `new Date()` parses
   correctly. PostgREST returns proper ISO ("...T...+00:00"), but the
   Realtime websocket hands back the raw Postgres text form
   ("2026-06-02 02:00:00+00" — a space separator and a 2-digit "+00"
   offset), which browsers misparse (often as the future → negative
   "ago"). This funnels both shapes to a single, parseable ISO string. */
const toIsoTs = (v) => {
  if (!v) return v;
  if (v instanceof Date) return v.toISOString();
  let s = String(v).trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (/[zZ]$/.test(s)) return s;                       // already has Z
  const m = s.match(/([+-]\d{2})(:?)(\d{2})?$/);       // trailing tz offset?
  if (m) return m[3] ? s : s.slice(0, m.index) + m[1] + ':00';  // "+00" -> "+00:00"
  return s + 'Z';                                      // no offset -> assume UTC
};
const ROW_TO_MSG = (r) => r && ({
  id:         r.id,
  thread:     r.table_label,
  sender:     r.sender,
  senderName: r.sender_name,
  role:       r.role,
  kind:       r.kind,
  body:       r.body,
  sizeBytes:  r.size_bytes || 0,
  ts:         toIsoTs(r.created_at),
  reaction:     r.reaction || null,
  replyTo:      r.reply_to || null,
  replyPreview: r.reply_preview || null,
});
const MSG_TO_ROW = (m) => ({
  id:          m.id,
  table_label: m.thread || null,
  sender:      m.sender,
  sender_name: m.senderName || null,
  role:        m.role,
  kind:        m.kind,
  body:        m.body || '',
  size_bytes:  m.sizeBytes || 0,
  created_at:  m.ts,
  reaction:      m.reaction || null,
  reply_to:      m.replyTo || null,
  reply_preview: m.replyPreview || null,
});

/* ----------------------------------------------------------------
   SERVER CLOCK OFFSET
   Relative chat times ("x ago") must not depend on the local device
   clock — a customer phone running a few minutes fast would show
   every freshly-arrived message as "3 min ago". We track the gap
   between this device and the DB server and expose a server-
   referenced "now". The offset is refreshed opportunistically every
   time we observe a freshly-created server timestamp (a message we
   just sent, or one arriving live), with a best-effort HTTP-header
   sync at boot so it's already close before the first message.
   ---------------------------------------------------------------- */
let serverClockOffset = 0;
const observeServerTime = (iso) => {
  if (!iso) return;
  const t = new Date(toIsoTs(iso)).getTime();
  if (!isNaN(t)) serverClockOffset = t - Date.now();
};
async function syncServerClock() {
  if (!REMOTE_MODE || typeof fetch !== 'function' || !navigator.onLine) return;
  try {
    const t0  = Date.now();
    // Read the server's `Date` header off a normal table the anon role can
    // read (bb_products has `for select using(true)`). The PostgREST ROOT
    // (/rest/v1/) is the OpenAPI spec endpoint and 401s even when authed, so
    // we hit a real data path instead. HEAD + limit=0 transfers no rows.
    // Both headers are required so PostgREST can resolve the anon role.
    const res = await fetch(SUPABASE_URL + '/rest/v1/bb_products?select=id&limit=0', {
      method: 'HEAD',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      cache: 'no-store',
    });
    const t1  = Date.now();
    const hdr = res.headers.get('date');           // may be hidden by CORS
    if (!hdr) return;
    const server = new Date(hdr).getTime();
    if (isNaN(server)) return;
    serverClockOffset = server - (t0 + (t1 - t0) / 2);  // midpoint of round-trip
  } catch (e) { /* offline / header not exposed — opportunistic sync covers it */ }
}
const ROW_TO_LOG = (r) => r && ({
  id:      r.id,
  type:    r.type,
  message: r.message,
  orderId: r.order_id || undefined,
  ts:      r.created_at,
  ...(r.payload || {}),
});
const LOG_TO_ROW = (e) => ({
  id:         e.id,
  type:       e.type,
  message:    e.message,
  order_id:   e.orderId || null,
  payload:    Object.fromEntries(
    Object.entries(e).filter(([k]) =>
      !['id','type','message','orderId','ts'].includes(k))
  ),
  created_at: e.ts,
});

/* ==========================================================
   SYNC STATE  (sync-status badge + offline write queue)
   - status: 'idle' | 'syncing' | 'offline' | 'error'
   - listeners: UI subscribes via Store.onSyncChange()
   - pendingCount: how many queued writes still need replay
   ========================================================== */
const syncState = { status: REMOTE_MODE ? 'idle' : 'idle', pendingCount: 0 };
const syncListeners = new Set();
function setSyncState(patch) {
  Object.assign(syncState, patch);
  syncListeners.forEach(fn => { try { fn(syncState); } catch {} });
}
function readPending() { return readJSON(STORE_KEYS.pendingWrites, []); }
function writePending(list) { writeJSON(STORE_KEYS.pendingWrites, list); setSyncState({ pendingCount: list.length }); }

/* Append a remote write to the pending queue so we can replay it
   when the network comes back. Each entry is { id, table, op,
   payload, ts } where op is 'upsert' | 'delete'. */
function queuePending(entry) {
  const list = readPending();
  // Deduplicate orders by id+op so retries don't pile up multiple
  // copies of the same row.
  const dedupKey = `${entry.op}:${entry.table}:${entry.payload && (entry.payload.id || entry.payload._delId) || ''}`;
  const filtered = list.filter(e => `${e.op}:${e.table}:${e.payload && (e.payload.id || e.payload._delId) || ''}` !== dedupKey);
  filtered.push({ id: 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), ts: Date.now(), ...entry });
  writePending(filtered);
}

/* Distinguish writes that can NEVER succeed on retry (RLS denial,
   constraint/validation, auth) from temporary ones (offline,
   timeout, 5xx, rate-limit). Permanent failures are DROPPED instead
   of being queued/retried, so a single rejected write can't become
   a "poison pill" that jams every later write behind it forever. */
function isPermanentError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  // Postgres / PostgREST permanent rejections.
  const permCodes = ['42501', '23502', '23503', '23514', '23505', '22P02', 'PGRST301'];
  if (permCodes.includes(code)) return true;
  const status = Number(error.status || error.statusCode || 0);
  // 4xx won't fix itself — except 408 (timeout) and 429 (rate-limit).
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return true;
  return false;
}

/* Replay all queued writes. Stops on the first TRANSIENT failure so
   we preserve order; permanent failures are dropped and skipped.
   Called on every successful remote write, on the `online` browser
   event, and on a 20s timer. */
let flushing = false;
async function flushPending() {
  if (!REMOTE_MODE || flushing) return;
  if (!navigator.onLine) { setSyncState({ status: 'offline' }); return; }
  flushing = true;
  let list = readPending();
  if (!list.length) { flushing = false; setSyncState({ status: 'idle' }); return; }
  setSyncState({ status: 'syncing' });
  for (const entry of list) {
    try {
      let result;
      if (entry.op === 'upsert') {
        result = await sb.from(entry.table).upsert(entry.payload);
      } else if (entry.op === 'delete') {
        const { _delCol, _delId } = entry.payload;
        result = await sb.from(entry.table).delete().eq(_delCol, _delId);
      }
      if (result && result.error) throw result.error;
      // Successful — remove from queue.
      list = readPending().filter(e => e.id !== entry.id);
      writePending(list);
    } catch (e) {
      if (isPermanentError(e)) {
        // Poison pill: this write can never succeed (e.g. RLS
        // denial). Drop it so it can't jam every queued write
        // behind it, and keep draining the rest of the queue.
        console.warn('[Store] dropping un-syncable write (permanent error)', entry, e);
        writePending(readPending().filter(x => x.id !== entry.id));
        continue;
      }
      console.warn('[Store] flush stalled, will retry later', e);
      setSyncState({ status: 'error' });
      flushing = false;
      return;
    }
  }
  flushing = false;
  setSyncState({ status: 'idle' });
}

/* Wrapper: try the remote write; on ANY failure (network, RLS,
   server) push it into the pending queue. The local cache was
   already updated optimistically by the caller, so the UI is
   unaffected — the queue ensures the write reaches Supabase
   eventually. */
function remoteUpsert(table, row) {
  if (!REMOTE_MODE) return Promise.resolve();
  if (!navigator.onLine) {
    queuePending({ table, op: 'upsert', payload: row });
    setSyncState({ status: 'offline' });
    return Promise.resolve();
  }
  return sb.from(table).upsert(row).then(({ error }) => {
    if (error) {
      // Self-heal for an additive column the backend doesn't have yet
      // (a newer client field whose migration hasn't been run): strip
      // the offending column and retry once so the rest of the row
      // still syncs and existing flow never breaks.
      const missing = missingColumnFrom(error, row);
      if (missing) {
        const { [missing]: _omit, ...rest } = row;
        console.warn(`[Store] '${missing}' column missing on ${table} — syncing without it (run the migration to enable it)`);
        return sb.from(table).upsert(rest).then(({ error: e2 }) => {
          if (e2) { queuePending({ table, op: 'upsert', payload: rest }); flushPending(); }
          else flushPending();
        });
      }
      if (isPermanentError(error)) {
        // Won't ever succeed on retry (RLS / validation / auth) —
        // drop it instead of queuing so one rejected write can't
        // jam the whole sync queue.
        console.error(`[Store] supabase upsert ${table} REJECTED (permanent) — not queued`, error);
        return;
      }
      console.warn(`[Store] supabase upsert ${table} failed — queued for retry`, error);
      queuePending({ table, op: 'upsert', payload: row });
      flushPending();
    } else {
      // Successful write is a good moment to drain anything that
      // was previously stuck.
      flushPending();
    }
  }).catch((e) => {
    console.warn(`[Store] supabase upsert ${table} network err — queued for retry`, e);
    queuePending({ table, op: 'upsert', payload: row });
  });
}
/* If a PostgREST error says a column isn't in the schema cache
   (PGRST204), return that column name when it's a key we sent — so
   the caller can drop it and retry. Returns null otherwise. */
function missingColumnFrom(error, row) {
  if (!error) return null;
  const msg = String(error.message || '');
  if (error.code !== 'PGRST204' && !/schema cache|could not find/i.test(msg)) return null;
  const m = msg.match(/'([a-zA-Z0-9_]+)' column/);
  const col = m && m[1];
  return (col && row && Object.prototype.hasOwnProperty.call(row, col)) ? col : null;
}
function remoteDelete(table, idCol, id) {
  if (!REMOTE_MODE) return Promise.resolve();
  if (!navigator.onLine) {
    queuePending({ table, op: 'delete', payload: { _delCol: idCol, _delId: id } });
    setSyncState({ status: 'offline' });
    return Promise.resolve();
  }
  return sb.from(table).delete().eq(idCol, id).then(({ error }) => {
    if (error) {
      if (isPermanentError(error)) {
        console.error(`[Store] supabase delete ${table} REJECTED (permanent) — not queued`, error);
        return;
      }
      console.warn(`[Store] supabase delete ${table} failed — queued for retry`, error);
      queuePending({ table, op: 'delete', payload: { _delCol: idCol, _delId: id } });
      flushPending();
    } else {
      flushPending();
    }
  }).catch((e) => {
    console.warn(`[Store] supabase delete ${table} network err — queued for retry`, e);
    queuePending({ table, op: 'delete', payload: { _delCol: idCol, _delId: id } });
  });
}

/* The browser tells us when connectivity comes back; flush
   immediately. Combined with the timer below this gives us
   belt-and-braces recovery. */
if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => { setSyncState({ status: 'idle' }); flushPending(); });
  window.addEventListener('offline', () => { setSyncState({ status: 'offline' }); });
  // Periodic safety net — catches cases where 'online' didn't fire.
  setInterval(flushPending, 20 * 1000);
  // Initialise the pending counter for the UI.
  setSyncState({ pendingCount: readPending().length });
}

/* ==========================================================
   STORE API
   ========================================================== */
const Store = {

  /* ----- Menu ----- */
  getMenu()        { return readJSON(STORE_KEYS.menu, DEFAULT_MENU); },
  setMenu(menu)    { return writeJSON(STORE_KEYS.menu, menu); },
  resetMenu()      { localStorage.removeItem(STORE_KEYS.menu); },

  /* ----- Favorites (per-device, no login required) -----
     A plain array of product ids kept in localStorage so any guest
     can favorite instantly. Stale ids (for items later removed from
     the menu) are harmless — callers filter against the live menu. */
  getFavorites()      { return readJSON(STORE_KEYS.favorites, []); },
  isFavorite(id)      { return Store.getFavorites().includes(id); },
  toggleFavorite(id) {
    const favs = Store.getFavorites();
    const idx  = favs.indexOf(id);
    if (idx === -1) favs.push(id);
    else            favs.splice(idx, 1);
    writeJSON(STORE_KEYS.favorites, favs);
    return idx === -1;              // true = now favorited, false = un-favorited
  },
  favoriteCount()     { return Store.getFavorites().length; },
  upsertMenuItem(item) {
    const menu = Store.getMenu();
    const idx  = menu.findIndex(m => m.id === item.id);
    if (idx === -1) menu.push(item);
    else            menu[idx] = item;
    Store.setMenu(menu);
    remoteUpsert('bb_products', PRODUCT_TO_ROW(item));
    return true;
  },
  deleteMenuItem(id) {
    Store.setMenu(Store.getMenu().filter(m => m.id !== id));
    remoteDelete('bb_products', 'id', id);
    return true;
  },

  /* ----- Config ----- */
  getConfig()       { return { ...DEFAULT_CONFIG, ...readJSON(STORE_KEYS.config, {}) }; },
  setConfig(patch)  {
    const merged = { ...Store.getConfig(), ...patch };
    writeJSON(STORE_KEYS.config, merged);
    remoteUpsert('bb_config', { id: 1, data: merged, updated_at: new Date().toISOString() });
    return true;
  },
  resetConfig()     { localStorage.removeItem(STORE_KEYS.config); },

  /* ----- Categories (data-driven menu groups) ----- */
  getCategories() {
    const cats = Store.getConfig().categories;
    return Array.isArray(cats) && cats.length ? cats : DEFAULT_CONFIG.categories;
  },
  /* Add a category from a free-text label. Slugifies the label into
     an id, dedupes (by id or label, case-insensitive), persists via
     setConfig so it syncs, and returns { category, created }. */
  addCategory(label) {
    label = String(label || '').trim();
    if (!label) return { category: null, created: false };
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ('cat-' + Date.now());
    const cats = Store.getCategories().slice();
    const existing = cats.find(c =>
      c.id === id || c.label.trim().toLowerCase() === label.toLowerCase());
    if (existing) return { category: existing, created: false };
    const category = { id, label };
    cats.push(category);
    Store.setConfig({ categories: cats });
    return { category, created: true };
  },

  /* ----- Custom option groups (data-driven item options) ----- */
  getOptionGroups() {
    const g = Store.getConfig().optionGroups;
    return Array.isArray(g) ? g : [];
  },
  /* Add an option group from a label + a list of { label, delta }
     choices. Slugifies the group id and each choice id, dedupes the
     group by id/label, persists via setConfig (so it syncs), and
     returns { group, created }. */
  addOptionGroup(label, choices) {
    label = String(label || '').trim();
    if (!label) return { group: null, created: false };
    const slug = (s, fb) => String(s || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || fb;
    const id = slug(label, 'opt-' + Date.now());
    const groups = Store.getOptionGroups().slice();
    const existing = groups.find(g =>
      g.id === id || g.label.trim().toLowerCase() === label.toLowerCase());
    if (existing) return { group: existing, created: false };
    const seen = new Set();
    const cleanChoices = (Array.isArray(choices) ? choices : [])
      .map((c, i) => {
        const clabel = String(c.label || '').trim();
        if (!clabel) return null;
        let cid = slug(clabel, 'c' + (i + 1));
        while (seen.has(cid)) cid += '_';
        seen.add(cid);
        return { id: cid, label: clabel, delta: Number(c.delta) || 0 };
      })
      .filter(Boolean);
    const group = { id, label, choices: cleanChoices };
    groups.push(group);
    Store.setConfig({ optionGroups: groups });
    return { group, created: true };
  },

  /* ==========================================================
     ORDERS
     - Statuses: 'pending' (just placed, waiting for staff)
                 'preparing' (barista is making it)
                 'served'   (delivered to table, complete)
                 'cancelled'
     ========================================================== */
  getOrders()      { return readJSON(STORE_KEYS.orders, []); },
  setOrders(o)     { return writeJSON(STORE_KEYS.orders, o); },

  async placeOrder({ locationIdentifier, items, notes } = {}) {
    // Server-aware, DAILY-RESETTING order numbering. Numbers
    // restart at #1 each calendar day so they don't grow without
    // bound (the lifetime tally lives in config + the CSV export).
    // We scope both the local and server max to orders placed
    // since local midnight, then take max(local, server) + 1 so
    // two devices ordering at once can't collide and a network
    // blip can't produce a number below what we already hold.
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const isToday  = (iso) => iso && new Date(iso) >= startOfDay;
    const localMax = Math.max(0, ...Store.getOrders()
      .filter(o => isToday(o.placedAt))
      .map(o => o.number || 0));
    let serverMax = 0;
    if (REMOTE_MODE && navigator.onLine) {
      try {
        const { data, error } = await sb
          .from('bb_orders')
          .select('number')
          .gte('placed_at', startOfDay.toISOString())
          .order('number', { ascending: false })
          .limit(1);
        if (!error && data && data[0]) serverMax = Number(data[0].number) || 0;
      } catch (e) {
        // Offline / blocked — fall back to local-only numbering.
      }
    }
    const number = Math.max(localMax, serverMax) + 1;
    // Session-based ordering (kiosk/QR model): the order is tied to this
    // device's session (clientId) and, if signed in, the account
    // (userId). No table is requested — locationIdentifier is an
    // optional free-text delivery hint set at checkout.
    const cust = Store.getCustomer && Store.getCustomer();
    const order = {
      id:          'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      number,
      locationIdentifier: locationIdentifier || null,
      clientId:    Store.getClientId(),       // device/session that placed it
      userId:      (cust && cust.id) || null, // account owner if signed in
      items,                                  // each: { itemId, name, qty, unitPrice, config }
      total:       items.reduce((s, i) => s + i.unitPrice * i.qty, 0),
      notes:       notes || '',
      status:      'pending',
      placedAt:    new Date().toISOString(),
      servedAt:    null,
    };
    const orders = Store.getOrders();
    orders.unshift(order);                    // newest first
    Store.setOrders(orders);
    remoteUpsert('bb_orders', ORDER_TO_ROW(order));
    // Monotonic lifetime tally (daily numbers reset; this doesn't).
    Store.setConfig({ lifetimeOrders: (Store.getConfig().lifetimeOrders || 0) + 1 });
    Store.pushLog({
      type:    'order_placed',
      message: `Order #${order.number} placed${order.locationIdentifier ? ` · ${order.locationIdentifier}` : ''}`,
      orderId: order.id,
    });
    // Checkout converts the session cart into an order → clear the cart
    // (the session itself persists for the next round).
    Store.archiveCartSession();
    return order;
  },

  updateOrderStatus(orderId, status) {
    const orders = Store.getOrders();
    const o = orders.find(x => x.id === orderId);
    if (!o) return false;
    o.status = status;
    if (status === 'served') o.servedAt = new Date().toISOString();
    Store.setOrders(orders);
    remoteUpsert('bb_orders', ORDER_TO_ROW(o));
    // Intentional: no log entry. Admin-initiated status changes
    // already produce a toast — the bell log is for events the
    // admin needs to be notified about (incoming orders,
    // customer cancellations), not their own actions.
    return true;
  },

  /* Modify the items on an order that hasn't started yet. Allowed
     only while still 'pending' (before the kitchen marks it
     preparing). Recomputes the total and re-syncs. Used by both the
     customer "Modify" flow (while still pending) and the admin
     order editor. */
  updateOrderItems(orderId, items, notes) {
    const orders = Store.getOrders();
    const o = orders.find(x => x.id === orderId);
    if (!o)                     return { ok: false, reason: 'not_found' };
    if (o.status !== 'pending') return { ok: false, reason: 'already_started' };
    if (!Array.isArray(items) || !items.length) return { ok: false, reason: 'empty' };
    o.items = items;
    o.total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    if (notes !== undefined) o.notes = notes;
    Store.setOrders(orders);
    remoteUpsert('bb_orders', ORDER_TO_ROW(o));
    Store.pushLog({
      type:    'order_modified',
      message: `Order #${o.number} modified`,
      orderId: o.id,
    });
    return { ok: true, order: o };
  },

  /* Re-label a set of orders onto a new table/name (the customer
     "move table" flow — the orders follow the person). Returns the
     count moved. */
  moveOrders(orderIds, newLabel) {
    if (!Array.isArray(orderIds) || !orderIds.length) return 0;
    const ids = new Set(orderIds);
    const orders = Store.getOrders();
    let moved = 0;
    for (const o of orders) {
      if (ids.has(o.id)) {
        o.tableNumber = newLabel || null;
        remoteUpsert('bb_orders', ORDER_TO_ROW(o));
        moved++;
      }
    }
    if (moved) Store.setOrders(orders);
    return moved;
  },

  /* Customer-initiated cancel. Only succeeds while the order is
     still pending (staff haven't started preparing it). Returns
     the order so the caller can restore the items into the cart. */
  customerCancelOrder(orderId) {
    const orders = Store.getOrders();
    const o = orders.find(x => x.id === orderId);
    if (!o)                       return { ok: false, reason: 'not_found' };
    if (o.status !== 'pending')   return { ok: false, reason: 'already_started' };
    o.status = 'cancelled';
    o.cancelledBy = 'customer';
    o.cancelledAt = new Date().toISOString();
    Store.setOrders(orders);
    remoteUpsert('bb_orders', ORDER_TO_ROW(o));
    Store.pushLog({
      type:    'order_status',
      status:  'cancelled',
      message: `Order #${o.number} cancelled by customer (before preparing)`,
      orderId: o.id,
    });
    return { ok: true, order: o };
  },

  /* A customer may cancel/modify their own order until staff start
     it. Status-based, no time window. */
  isCancellableByCustomer(order) {
    return !!order && order.status === 'pending';
  },

  /* All orders this browser has placed that haven't been
     "dismissed" by the customer (served+acknowledged or deleted).
     Used to drive the customer's "My orders" popup. */
  getMyOrders() {
    const cid = Store.getClientId();
    const cust = Store.getCustomer && Store.getCustomer();
    const uid  = cust && cust.id;
    // Ownership is exclusive once an order is claimed: a claimed
    // order (o.userId set) matches ONLY the account it belongs to —
    // never by clientId, even on the device that originally placed
    // it. Otherwise, after a guest order gets linked to an account
    // and that customer signs out, the same physical device would
    // still show it (clientId still matches) until the next reset —
    // a stale ownership leak on shared/kiosk devices. Only a truly
    // UNCLAIMED order (o.userId is null) falls back to the device's
    // own clientId, which is the actual "still just a guest" case.
    return Store.getOrders().filter(o =>
      o.userId ? o.userId === uid : o.clientId === cid
    );
  },

  /* All orders at a table label, from EVERY device — this is the
     combined view a joined customer sees ("our table's orders"),
     not just what this device placed. Newest first. */
  getTableOrders(label) {
    if (!label) return Store.getMyOrders();
    const needle = String(label).trim().toLowerCase();
    return Store.getOrders().filter(o =>
      String(o.tableNumber || '').trim().toLowerCase() === needle
    );
  },

  /* Orders at a given table label that are still active (pending
     or preparing). Used to detect duplicate-table conflicts when
     a different device claims the same label. */
  findActiveOrdersByTable(tableLabel) {
    if (!tableLabel) return [];
    const needle = String(tableLabel).trim().toLowerCase();
    return Store.getOrders().filter(o =>
      (o.status === 'pending' || o.status === 'preparing') &&
      String(o.tableNumber || '').trim().toLowerCase() === needle
    );
  },

  /* Find the room (table label) that a join PIN belongs to, by
     scanning active orders. Returns { label, count, pin } or null.
     Pins are minted unique per active table, so a hit is unambiguous;
     getOrders() is newest-first so legacy duplicate pins resolve to
     the most recent room. */
  findTableByPin(pin) {
    pin = String(pin || '').trim();
    if (!pin) return null;
    const matches = Store.getOrders().filter(o =>
      (o.status === 'pending' || o.status === 'preparing') &&
      String(o.joinPin || '') === pin);
    if (!matches.length) return null;
    const label = matches[0].tableNumber;
    return { label, count: matches.length, pin };
  },

  deleteOrder(orderId) {
    Store.setOrders(Store.getOrders().filter(x => x.id !== orderId));
    remoteDelete('bb_orders', 'id', orderId);
    return true;
  },

  clearServedOrders() {
    const served = Store.getOrders().filter(o => o.status === 'served');
    Store.setOrders(Store.getOrders().filter(o => o.status !== 'served'));
    if (REMOTE_MODE && served.length) {
      sb.from('bb_orders').delete().eq('status', 'served').then(({ error }) => {
        if (error) console.warn('[Store] supabase clear-served failed', error);
      });
    }
    return true;
  },

  /* Per-browser anonymous id. Generated on first call and
     persisted. Used to scope "My orders" to this device and to
     detect duplicate-table conflicts across devices. */
  getClientId() {
    let id = localStorage.getItem(STORE_KEYS.client);
    if (!id) {
      id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(STORE_KEYS.client, id);
    }
    return id;
  },
  /* Mint a fresh clientId. Old orders stamped with the previous
     id are still in the store (admin can see them) but they no
     longer match Store.getMyOrders() for this browser — so the
     next customer at this device gets a clean "My orders" list.
     The outgoing id is remembered in a capped history so other
     "is this mine?" checks (chat ownership, table headcount,
     room reclaim) can still recognise this physical device across
     the reset, even though the per-visit "My orders" scope above
     intentionally narrows to the new id only. */
  resetClientId() {
    const old = localStorage.getItem(STORE_KEYS.client);
    if (old) {
      const hist = Store.getClientIdHistory().filter(h => h !== old);
      hist.unshift(old);
      if (hist.length > 10) hist.length = 10;
      writeJSON(STORE_KEYS.clientHistory, hist);
    }
    const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(STORE_KEYS.client, id);
    return id;
  },
  /* Sever this device from every id it has held: fresh id, empty
     history. resetClientId() deliberately keeps the history so
     device-scoped checks (chat ownership, table headcount) survive a
     visit reset; that's wrong when we're ending a PERSONA, because the
     history is what makes a previous account's orders keep looking
     like "this session's orders" (see sessionOrdersForeignTo) and
     re-triggers the account-switch prompt on the next sign-in. */
  hardResetClientId() {
    writeJSON(STORE_KEYS.clientHistory, []);
    const id = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(STORE_KEYS.client, id);
    return id;
  },
  /* Adopt a specific clientId as THIS device's current id (the inverse
     of resetClientId). Used when a returning customer signs in: we
     re-adopt the id that holds their active orders so getMyOrders +
     the "is this my table?" membership checks recognise them again —
     letting them resume without re-entering a PIN/table. */
  adoptClientId(id) {
    if (!id) return Store.getClientId();
    const old = localStorage.getItem(STORE_KEYS.client);
    if (old && old !== id) {
      const hist = Store.getClientIdHistory().filter(h => h !== old && h !== id);
      hist.unshift(old);
      if (hist.length > 10) hist.length = 10;
      writeJSON(STORE_KEYS.clientHistory, hist);
    }
    localStorage.setItem(STORE_KEYS.client, id);
    return id;
  },
  /* Past client ids for THIS browser (newest first), capped at 10. */
  getClientIdHistory() { return readJSON(STORE_KEYS.clientHistory, []); },
  /* Current id plus every past id this browser has held — the set
     that all "is this the same device/person?" checks should use
     (everything except getMyOrders, which stays scoped to current). */
  getMyClientIds() { return [Store.getClientId(), ...Store.getClientIdHistory()]; },

  /* ==========================================================
     CART SESSION  (kiosk/QR model)
     A persistent per-device, per-restaurant cart. Created on first
     use, restored on refresh / QR re-scan, and only reset after
     inactivity. The session id is the device clientId, so orders,
     chat and cart all key off the same identity. Distinct from an
     order: checkout converts the cart into a NEW orderId.
     ========================================================== */
  _freshCartSession() {
    const now = Date.now();
    return {
      sessionId:    Store.getClientId(),   // = device id; one source of truth
      restaurantId: RESTAURANT_ID,
      cartItems:    [],
      createdAt:    new Date(now).toISOString(),
      expiresAt:    new Date(now + CART_SESSION_TTL_MS).toISOString(),
    };
  },
  /* Get the live session, recreating it if missing, for a different
     device id (after a login reset), a different restaurant, or past
     its inactivity expiry. */
  getCartSession() {
    let s = readJSON(STORE_KEYS.cartSession, null);
    const now = Date.now();
    const cid = Store.getClientId();
    const valid = s && s.restaurantId === RESTAURANT_ID && s.sessionId === cid
                  && s.expiresAt && new Date(s.expiresAt).getTime() >= now;
    if (!valid) {
      s = Store._freshCartSession();
      writeJSON(STORE_KEYS.cartSession, s);
    }
    return s;
  },
  getSessionId() { return Store.getCartSession().sessionId; },
  /* Sliding expiry — call on any activity so an active cart never times
     out mid-visit. */
  touchCartSession() {
    const s = Store.getCartSession();
    s.expiresAt = new Date(Date.now() + CART_SESSION_TTL_MS).toISOString();
    writeJSON(STORE_KEYS.cartSession, s);
    return s;
  },
  getCart() { return Store.getCartSession().cartItems || []; },
  setCart(items) {
    const s = Store.getCartSession();
    s.cartItems = Array.isArray(items) ? items : [];
    s.expiresAt = new Date(Date.now() + CART_SESSION_TTL_MS).toISOString();
    writeJSON(STORE_KEYS.cartSession, s);
    return s.cartItems;
  },
  /* After a successful order: empty the cart but keep the same session
     so the device can keep ordering in the same visit. */
  archiveCartSession() {
    const s = Store.getCartSession();
    s.cartItems = [];
    writeJSON(STORE_KEYS.cartSession, s);
  },

  /* ==========================================================
     ACCOUNT LINKING  (guest → account)
     When a guest signs in/registers, the orders placed in their
     current device session are linked to the account by stamping
     userId — preserving each orderId (single source of truth). Points
     are credited per orderId (idempotent via perks.awardedOrders), so
     migrated orders count exactly once and can't double-count.
     ========================================================== */
  /* Orders placed by THIS device's session(s) — newest first. */
  getSessionOrders() {
    const mine = new Set(Store.getMyClientIds());
    return Store.getOrders().filter(o => mine.has(o.clientId));
  },
  /* Did this session place orders already owned by a DIFFERENT account?
     Used to require explicit confirmation before switching accounts on
     a shared device (keeps accounts strictly separate). */
  sessionOrdersForeignTo(userId) {
    return Store.getSessionOrders().some(o => o.userId && o.userId !== userId);
  },
  /* Attach userId to this session's orders that aren't already owned by
     this account. Idempotent: never duplicates, never regenerates an
     orderId; only updates ownership metadata. Returns the count linked. */
  linkSessionOrdersToAccount(userId) {
    if (!userId) return 0;
    const mine = new Set(Store.getMyClientIds());
    const orders = Store.getOrders();
    let linked = 0;
    for (const o of orders) {
      if (mine.has(o.clientId) && o.userId !== userId) {
        o.userId = userId;
        remoteUpsert('bb_orders', ORDER_TO_ROW(o));
        linked++;
      }
    }
    if (linked) Store.setOrders(orders);
    return linked;
  },

  /* ==========================================================
     SESSION TABLE  (local re-entry CONVENIENCE — not a reservation)
     - This is purely a same-device convenience: it survives a
       page refresh so the visitor isn't re-asked for their name
       just because they reloaded ("keep my name for today" on
       THIS device). It expires after 24h, or sooner when a reset
       clears it, so a different person at the same device the
       next day gets a fresh prompt.
     - It does NOT reserve the name against anyone. Name
       exclusivity is a *lease* enforced elsewhere: the live
       ACTIVE SESSIONS registry below (30-min heartbeat) plus any
       active order at the table. When the visit ends the room is
       abolished (see resetForNextCustomer) and the name is freed
       immediately — there is no fixed 24h lock-out.
     ========================================================== */
  getSessionTable() {
    const rec = readJSON(STORE_KEYS.sessionTable, null);
    if (!rec) return null;
    if (Date.now() - rec.ts > SESSION_TABLE_TTL_MS) {
      localStorage.removeItem(STORE_KEYS.sessionTable);
      return null;
    }
    return rec;
  },
  setSessionTable(name) {
    if (!name) return;
    writeJSON(STORE_KEYS.sessionTable, {
      name,
      ts:       Date.now(),
      clientId: Store.getClientId(),
    });
  },
  clearSessionTable() {
    localStorage.removeItem(STORE_KEYS.sessionTable);
  },


  /* ==========================================================
     ACTIVE SESSIONS REGISTRY  (live name-collision check)
     - Every customer that has set a table label appears here
       with their lastActive timestamp.
     - Used to block two devices from holding the SAME name at
       the SAME TIME, even if neither has placed an order yet.
     - Self-pruning: entries older than 30 minutes are dropped
       on every read so a dead session frees up the name.
     ========================================================== */
  _readSessions() {
    const raw = readJSON(STORE_KEYS.activeSessions, {});
    const now = Date.now();
    let mutated = false;
    for (const cid of Object.keys(raw)) {
      if (now - (raw[cid].lastActive || 0) > ACTIVE_SESSION_TTL_MS) {
        delete raw[cid]; mutated = true;
      }
    }
    if (mutated) writeJSON(STORE_KEYS.activeSessions, raw);
    return raw;
  },
  /* Returns the conflicting clientId, or null if the name is free.
     LOCAL-only — catches collisions between tabs of the SAME
     browser. Cross-device collisions need the async remote check
     below (the local registry can't see another device). */
  findActiveSessionByName(name) {
    if (!name) return null;
    const myId   = Store.getClientId();
    const needle = String(name).trim().toLowerCase();
    const all    = Store._readSessions();
    for (const cid of Object.keys(all)) {
      if (cid === myId) continue;
      if ((all[cid].name || '').trim().toLowerCase() === needle) {
        return { clientId: cid, pin: all[cid].pin || null };
      }
    }
    return null;
  },
  /* This device's own name PIN — the 4-digit code minted when it
     claimed its current name. Shared with friends so they can take/
     merge the name from another device, and reused as the order join
     PIN on the first order so a table keeps one code throughout. */
  getMyNamePin() {
    const s = Store._readSessions()[Store.getClientId()];
    return (s && s.pin) || null;
  },
  /* Cross-device collision check via Supabase. Returns the
     conflicting client_id, or null. Only meaningful in remote
     mode; in local mode it resolves null (the local check above
     is all we have). Filters out our own row and any session
     that hasn't heartbeat-ed within the TTL. */
  async findActiveSessionByNameRemote(name) {
    if (!name || !REMOTE_MODE || !navigator.onLine) return null;
    const needle  = String(name).trim().toLowerCase();
    const myId    = Store.getClientId();
    const cutoff  = new Date(Date.now() - ACTIVE_SESSION_TTL_MS).toISOString();
    try {
      let { data, error } = await sb
        .from('bb_sessions')
        .select('client_id, name, last_active, pin')
        .ilike('name', needle)
        .gt('last_active', cutoff);
      // Graceful degradation: if the `pin` column hasn't been added yet
      // the select errors — retry without it so collision detection
      // still works (the modal just falls back to the legacy reclaim).
      if (error) {
        ({ data, error } = await sb
          .from('bb_sessions')
          .select('client_id, name, last_active')
          .ilike('name', needle)
          .gt('last_active', cutoff));
      }
      if (error || !data) return null;
      const hit = data.find(r =>
        r.client_id !== myId &&
        String(r.name || '').trim().toLowerCase() === needle
      );
      return hit ? { clientId: hit.client_id, pin: hit.pin || null } : null;
    } catch (e) {
      return null;   // network hiccup — fail open, don't block ordering
    }
  },
  bumpActiveSession(name, forcePin) {
    if (!name) { Store.dropActiveSession(); return; }
    const all = Store._readSessions();
    const cid = Store.getClientId();
    const prev = all[cid];
    // Keep the PIN stable while the name is unchanged; mint a fresh
    // 4-digit code when the name changes (or none exists yet). forcePin
    // lets a device that just PIN-merged into an existing name ADOPT that
    // name's PIN, so every device under one name shares a single code.
    const sameName = prev && (prev.name || '').trim().toLowerCase() === String(name).trim().toLowerCase();
    const pin = forcePin || ((sameName && prev.pin) ? prev.pin : String(Math.floor(1000 + Math.random() * 9000)));
    all[cid] = { name, lastActive: Date.now(), pin };
    writeJSON(STORE_KEYS.activeSessions, all);
    // Mirror to Supabase so other devices can see this claim + its PIN.
    // Best-effort presence data — no retry queue (a missed heartbeat
    // just makes the row look stale, which is fine). If the `pin` column
    // isn't present yet, retry once without it so presence still works.
    if (REMOTE_MODE && navigator.onLine) {
      const row = { client_id: cid, name, last_active: new Date().toISOString(), pin };
      sb.from('bb_sessions').upsert(row).then(({ error }) => {
        if (error) {
          console.warn('[Store] session upsert failed', error);
          const { pin: _omit, ...noPin } = row;
          sb.from('bb_sessions').upsert(noPin).then(() => {});
        }
      });
    }
  },
  dropActiveSession() {
    const all = Store._readSessions();
    delete all[Store.getClientId()];
    writeJSON(STORE_KEYS.activeSessions, all);
    if (REMOTE_MODE && navigator.onLine) {
      sb.from('bb_sessions').delete().eq('client_id', Store.getClientId())
        .then(({ error }) => { if (error) console.warn('[Store] session delete failed', error); });
    }
  },

  /* ==========================================================
     CHAT  (customer ↔ staff, per-table thread)
     Remote-first: in Supabase mode messages live in bb_messages
     and arrive live via realtime. In local mode they fall back
     to a capped localStorage array (single-device, dev only).
     Media is base64 inline; pruneMedia trims the oldest when the
     combined media footprint exceeds MEDIA_CAP_BYTES.
     ========================================================== */
  async listMessages(thread) {
    if (REMOTE_MODE && navigator.onLine) {
      try {
        const { data, error } = await sb.from('bb_messages')
          .select('*').eq('table_label', thread)
          .order('created_at', { ascending: true }).limit(300);
        if (!error && data) return data.map(ROW_TO_MSG);
      } catch (e) {}
      return [];
    }
    return readJSON('bb_chat_local', []).filter(m => m.thread === thread);
  },
  /* Group messages into per-table conversations for the admin's
     Messenger-style sidebar. Returns [{ thread, last, count }] sorted
     by most-recent activity (newest first). Only tables that have at
     least one message appear. Remote mode pulls a recent window and
     groups client-side (PostgREST has no GROUP BY); local mode groups
     the cached blob. */
  async listThreads() {
    let rows = [];
    if (REMOTE_MODE && navigator.onLine) {
      try {
        const { data, error } = await sb.from('bb_messages')
          .select('*').order('created_at', { ascending: false }).limit(500);
        if (!error && data) rows = data.map(ROW_TO_MSG);
      } catch (e) { rows = []; }
    } else {
      rows = readJSON('bb_chat_local', [])
        .slice()
        .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    }
    // rows are newest-first, so the first row seen per thread is its
    // latest message.
    const byThread = new Map();
    for (const m of rows) {
      if (!m.thread) continue;
      let g = byThread.get(m.thread);
      if (!g) { g = { thread: m.thread, last: m, count: 0, name: null }; byThread.set(m.thread, g); }
      g.count++;
      // rows are newest-first → first customer name seen is the latest.
      if (!g.name && m.role === 'customer' && m.senderName) g.name = m.senderName;
    }
    return [...byThread.values()].sort(
      (a, b) => new Date(b.last.ts) - new Date(a.last.ts));
  },
  async sendMessage({ thread, role, senderName, kind, body, replyTo = null, replyPreview = null }) {
    const msg = {
      id:        'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      thread:    thread || null,
      sender:    role === 'admin' ? 'admin' : Store.getClientId(),
      senderName: senderName || (role === 'admin' ? 'Staff' : 'Guest'),
      role,
      kind,
      body:      body || '',
      sizeBytes: kind === 'text' ? 0 : (body ? body.length : 0),
      ts:        new Date().toISOString(),
      reaction:     null,
      replyTo:      replyTo || null,
      replyPreview: replyPreview || null,
    };
    if (REMOTE_MODE && navigator.onLine) {
      // Let Postgres stamp created_at with its OWN clock (the column
      // defaults to now()). Sending a device-local timestamp meant a
      // device with a skewed clock (e.g. an admin tablet a few minutes
      // slow) produced messages that sorted out of order and showed
      // wrong "x ago" times to the other party. We omit created_at,
      // then read the server-assigned value back and adopt it so the
      // sender's own optimistic echo matches what everyone else sees.
      let row = MSG_TO_ROW(msg);
      delete row.created_at;
      // Resilient insert: if the reaction/reply columns aren't in the
      // DB yet (migration not run), strip the offending column and
      // retry so plain chat keeps working regardless.
      let data, error;
      for (let attempt = 0; attempt < 4; attempt++) {
        ({ data, error } = await sb.from('bb_messages').insert(row).select('created_at').single());
        if (!error) break;
        const missing = missingColumnFrom(error, row);
        if (!missing) break;
        const clone = { ...row }; delete clone[missing]; row = clone;
      }
      if (error) { console.warn('[Store] message insert failed', error); throw error; }
      if (data && data.created_at) { msg.ts = toIsoTs(data.created_at); observeServerTime(data.created_at); }
      if (kind !== 'text') Store.pruneMedia();   // keep media under cap
    } else {
      const all = readJSON('bb_chat_local', []);
      all.push(msg);
      Store._pruneLocalChat(all);
      writeJSON('bb_chat_local', all);
      // Same-tab + cross-tab notification (no realtime locally).
      window.dispatchEvent(new CustomEvent('bb-chat', { detail: { message: msg } }));
    }
    return msg;
  },
  /* Set (or clear, with null) the single "❤️" reaction on a message.
     Remote: a one-column UPDATE; the realtime UPDATE feed mirrors it
     to the other device. Local mode patches the cached blob and fans
     out a bb-chat-update event. */
  async setReaction(messageId, reaction) {
    if (!messageId) return;
    if (REMOTE_MODE && navigator.onLine) {
      const { error } = await sb.from('bb_messages')
        .update({ reaction: reaction || null }).eq('id', messageId);
      if (error) { console.warn('[Store] reaction update failed', error); throw error; }
    } else {
      const all = readJSON('bb_chat_local', []);
      const m = all.find(x => x.id === messageId);
      if (m) {
        m.reaction = reaction || null;
        writeJSON('bb_chat_local', all);
        window.dispatchEvent(new CustomEvent('bb-chat-update', { detail: { message: m } }));
      }
    }
  },
  /* Delete oldest media messages until combined media size is
     back under the cap. Text messages are untouched. */
  async pruneMedia() {
    if (!REMOTE_MODE || !navigator.onLine) return;
    try {
      const { data, error } = await sb.from('bb_messages')
        .select('id, size_bytes, created_at')
        .in('kind', ['image', 'audio'])
        .order('created_at', { ascending: true });
      if (error || !data) return;
      let total = data.reduce((s, r) => s + (r.size_bytes || 0), 0);
      const doomed = [];
      for (const r of data) {
        if (total <= MEDIA_CAP_BYTES) break;
        doomed.push(r.id);
        total -= (r.size_bytes || 0);
      }
      if (doomed.length) {
        await sb.from('bb_messages').delete().in('id', doomed);
        console.info(`[Store] pruned ${doomed.length} old media message(s) to stay under cap`);
      }
    } catch (e) {}
  },
  /* Local-mode cap: keep the localStorage chat blob small so it
     can't blow the ~5 MB quota. Drops oldest media first, then
     oldest messages, until under ~3 MB. */
  _pruneLocalChat(all) {
    const LOCAL_CAP = 3 * 1024 * 1024;
    const size = (arr) => arr.reduce((s, m) => s + (m.sizeBytes || (m.body ? m.body.length : 0)), 0);
    // Drop oldest media first.
    while (size(all) > LOCAL_CAP) {
      const idx = all.findIndex(m => m.kind !== 'text');
      if (idx === -1) break;
      all.splice(idx, 1);
    }
    // Still over? Drop oldest messages outright.
    while (size(all) > LOCAL_CAP && all.length) all.shift();
    return all;
  },
  /* Abolish a table's chat thread when its visit ends, so the next
     customer who reuses the same label starts with an empty room
     (and the previous customer's own messages can't reappear flipped
     to the wrong side after a clientId reset). Clears both the local
     fallback blob and, in remote mode, the synced rows. The realtime
     DELETE subscription fans the removals out to any other device
     still showing the thread. */
  async clearThread(label) {
    if (!label) return;
    // Local fallback store.
    const all = readJSON('bb_chat_local', []);
    const kept = all.filter(m => m.thread !== label);
    if (kept.length !== all.length) writeJSON('bb_chat_local', kept);
    // Remote rows.
    if (REMOTE_MODE && navigator.onLine) {
      try {
        const { error } = await sb.from('bb_messages').delete().eq('table_label', label);
        if (error) console.warn('[Store] clearThread remote delete failed', error);
      } catch (e) {
        console.warn('[Store] clearThread network err', e);
      }
    }
  },

  /* ==========================================================
     ACTIVITY LOG  (admin notification feed)
     Capped at 50 entries. Each entry: { id, type, message, ts,
     status?, orderId?, undo? }. Undo payload is opaque to the
     store — the script.js layer interprets it.
     ========================================================== */
  getLog()  { return readJSON(STORE_KEYS.log, []); },
  setLog(l) { return writeJSON(STORE_KEYS.log, l); },
  pushLog(entry) {
    const log = Store.getLog();
    const id  = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const row = { id, ts: new Date().toISOString(), ...entry };
    log.unshift(row);
    if (log.length > 50) log.length = 50;
    Store.setLog(log);
    remoteUpsert('bb_activity', LOG_TO_ROW(row));
    return id;
  },
  clearLog() { localStorage.removeItem(STORE_KEYS.log); },
  markLogSeen(latestId) {
    if (latestId) localStorage.setItem(STORE_KEYS.logSeen, latestId);
  },
  getUnseenLogCount() {
    const seen = localStorage.getItem(STORE_KEYS.logSeen);
    const log  = Store.getLog();
    if (!seen) return log.length;
    const idx  = log.findIndex(e => e.id === seen);
    return idx === -1 ? log.length : idx;
  },

  /* Menu helpers — kept as thin wrappers so callers don't change.
     Admin-initiated saves/adds are confirmed by toast; only deletes
     produce a log entry so the admin can find them later if they
     want to undo from the bell. */
  upsertMenuItemLogged(item) {
    Store.upsertMenuItem(item);
  },
  deleteMenuItemLogged(id) {
    const existing = Store.getMenu().find(m => m.id === id);
    Store.deleteMenuItem(id);
    if (existing) Store.pushLog({
      type:    'menu_delete',
      message: `Deleted "${existing.name}"`,
      undo:    { kind: 'menu_item', item: existing },
    });
  },

  /* ==========================================================
     ADMIN AUTH
     - Only admin accounts. No customer registration UI.
     - Default admin is force-synced on every boot so login is
       always reliable in this prototype.
     ========================================================== */
  async getUsers() { return readJSON(STORE_KEYS.users, []); },

  /* ----- Real staff auth (Supabase Auth) -----
     Mirrors loginCustomer(): REMOTE mode goes through
     sb.auth.signInWithPassword + _syncStaffFromAuthSession instead of
     a client-side hash compare, so the credential never leaves
     Supabase and a session can't be forged by editing localStorage.
     LOCAL mode (no Supabase configured) keeps the original hash
     compare so the app still works standalone. */
  async login({ email, password }) {
    if (!REMOTE_MODE) {
      const users = await Store.getUsers();
      const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (!user) throw new Error('No account found for that email');
      const hash = await hashPassword(password);
      if (hash !== user.passwordHash) throw new Error('Incorrect password');
      if (user.role !== 'admin')      throw new Error('Staff access only');
      return Store._mintAdminSession(user);
    }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message === 'Invalid login credentials') throw new Error('Incorrect email or password');
      if (error.message === 'Email not confirmed') {
        throw new Error('Please confirm your email first — check your inbox for the link we sent.');
      }
      throw new Error(error.message || 'Sign-in failed');
    }
    return Store._syncStaffFromAuthSession(data.session);
  },

  /* Shared by the password path (login) and the Google path
     (_syncStaffFromAuthSession) — one place that defines what a
     staff session looks like. `authSession` (the real Supabase Auth
     session, REMOTE mode only) supplies the real JWT expiry so the
     local session cache expires when the real credential does,
     instead of on a fabricated timer; LOCAL mode has no such session
     to draw from and keeps the original flat 8-hour TTL. */
  _mintAdminSession(user, authSession) {
    const session = {
      email:      user.email,
      name:       user.name,
      role:       user.role,
      authUserId: user.authUserId || (authSession && authSession.user && authSession.user.id) || null,
      issuedAt:   Date.now(),
      expiresAt:  (authSession && authSession.expires_at)
        ? authSession.expires_at * 1000
        : Date.now() + (1000 * 60 * 60 * 8),
    };
    writeJSON(STORE_KEYS.session, session);
    return session;
  },

  /* Google sign-in for staff — bolted onto the existing local
     bb_accounts/PEPPER admin system rather than migrating admins to
     Supabase Auth (customers already made that move; admins haven't
     yet). Supabase OAuth is used ONLY to prove "this browser controls
     this Google email" — the actual admin session that comes out of
     it is still the local session shape login() produces. The
     STAFF_OAUTH_PARAM query param on redirectTo tells
     resumeAuthSession() apart from a customer's Google sign-in when
     the redirect lands back on index.html, since both use the same
     Supabase Auth session under the hood.

     `inviteCode` is optional and only ever passed by register.html's
     Google button — it collects + validates the code up front (same
     as its manual form), then carries it through the redirect so a
     brand-new staff member isn't asked for the code a second time on
     the way back. The Staff Login modal calls this with no code;
     existing admins don't need one, and a truly new sign-up is
     redirected to register.html's Google button instead (see
     completeStaffSignIn's needsInviteCode handling on the resume
     side, which still enforces the code even if this param is
     tampered with or omitted). */
  async loginStaffWithGoogle(inviteCode) {
    if (!REMOTE_MODE) throw new Error('Google sign-in requires Supabase to be configured');
    let redirectTo = appUrl('index.html', `${STAFF_OAUTH_PARAM}=1`);
    if (inviteCode) redirectTo += `&inviteCode=${encodeURIComponent(inviteCode)}`;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw new Error(error.message || 'Could not start Google sign-in');
  },

  /* Completes staff sign-in (password OR Google) given a real
     Supabase Auth session. Mirrors _syncCustomerFromAuthSession's
     structure: look up by the linked authUserId first (the fast path
     for every returning admin, including the dashboard-linked master
     admin — its auth_user_id was stamped directly in Postgres by
     data/admin-auth-migration.sql's manual step), falling back to an
     email match only to upgrade a legacy pre-migration row on its
     first real sign-in. The Supabase session now PERSISTS — earlier
     versions of this function signed it out right after, treating it
     as a one-shot identity check with a separate local session as
     the real credential; that's what let a freshly-created account
     get silently wiped by the next boot's authoritative bb_accounts
     pull, since nothing but an unverified local blob backed it. */
  async _syncStaffFromAuthSession(session, inviteCodeIfNew) {
    const authUser = session.user;
    const email = (authUser?.email || '').toLowerCase();
    if (!email) throw new Error('Google did not return an email address');
    const users = await Store.getUsers();
    let user = users.find(u => u.authUserId === authUser.id && u.role === 'admin');

    if (!user) {
      // Not linked yet — try to upgrade an existing row by email
      // (a legacy pre-migration admin signing in for the first time
      // since, or the dashboard-created master admin before its
      // auth_user_id UPDATE has synced into the local cache).
      const existingByEmail = users.find(u => (u.email || '').toLowerCase() === email);
      if (existingByEmail && existingByEmail.role !== 'admin') {
        // This Google/Supabase identity already belongs to a
        // customer account — never silently upgrade it or create a
        // second row against the same auth_user_id (the DB's unique
        // partial index would reject that with a confusing raw
        // error); fail with a clear message instead.
        throw new Error('This email is already registered as a customer account. Staff accounts must use a different email address.');
      }
      if (existingByEmail) {
        user = { ...existingByEmail, authUserId: authUser.id };
        const idx = users.findIndex(u => u.id === user.id);
        users[idx] = user;
        writeJSON(STORE_KEYS.users, users);
        remoteUpsert('bb_accounts', USER_TO_ROW(user));
      } else {
        // Brand-new admin — the invite code is the only gate.
        const expected = Store.getInviteCode();
        if (!inviteCodeIfNew || String(inviteCodeIfNew).trim() !== expected) {
          const err = new Error('Invalid invite code. Ask an existing admin for the current code.');
          err.needsInviteCode = true;
          err.pendingEmail = email;
          throw err;
        }
        const name = (authUser.user_metadata?.full_name || authUser.user_metadata?.name
          || email.split('@')[0] || 'Staff')
          .trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'Staff';
        user = {
          id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          email, name, role: 'admin',
          passwordHash: null,           // real credential lives in Supabase Auth
          authUserId: authUser.id,
          createdAt: new Date().toISOString(),
        };
        users.push(user);
        writeJSON(STORE_KEYS.users, users);
        remoteUpsert('bb_accounts', USER_TO_ROW(user));
      }
    }

    return Store._mintAdminSession(user, session);
  },

  /* Public entry point for completing a staff Google sign-in that
     stopped to ask for an invite code (resumeAuthSession() returned
     staff.staffNeedsInviteCode). Call with the code the admin typed
     and the authSession it handed back. Throws the same
     "Invalid invite code" error again if it's still wrong — the
     Supabase Auth session is retained (not signed out) until this
     either succeeds or the caller gives up, so the admin isn't sent
     through the whole Google redirect again just to retry the code. */
  async completeStaffGoogleSignIn(authSession, inviteCode) {
    return Store._syncStaffFromAuthSession(authSession, inviteCode);
  },

  /* Called when the admin cancels the invite-code prompt instead of
     completing it — drops the Google identity check they just did
     rather than leaving a signed-in-but-unlinked Supabase session
     sitting in the browser. */
  abandonStaffGoogleSignIn() {
    if (REMOTE_MODE) sb.auth.signOut().catch(() => {});
  },

  logout() {
    const s = readJSON(STORE_KEYS.session, null);
    localStorage.removeItem(STORE_KEYS.session);
    // Clear the real Supabase Auth session too (mirrors
    // logoutCustomer()) — REMOTE-mode admin sessions now persist
    // (see _syncStaffFromAuthSession), so without this a "signed
    // out" admin would still have a live, silently-refreshing
    // Supabase session in the browser that resumeAuthSession() could
    // resurrect on the next page load.
    //
    // NOT unconditional, though: resumeOrClearOnLogin() calls this
    // to drop a STALE admin session AFTER a customer has already
    // signed in on the same device (loginCustomer's own Supabase
    // sign-in runs first and completes before this fires) — the live
    // Supabase session at that point already belongs to the
    // customer, not the admin being cleared. Only sign out of
    // Supabase if the live session's user still matches the admin
    // session we're actually dropping, so a customer who just signed
    // in isn't immediately signed back out by this cleanup.
    if (REMOTE_MODE && s && s.authUserId) {
      sb.auth.getSession().then(({ data }) => {
        if (data.session && data.session.user && data.session.user.id === s.authUserId) {
          sb.auth.signOut().catch(() => {});
        }
      }).catch(() => {});
    }
  },
  getSession()    {
    const s = readJSON(STORE_KEYS.session, null);
    if (!s)                          return null;
    if (s.expiresAt < Date.now()) { Store.logout(); return null; }
    return s;
  },
  /* The live account row backing the current session, read from
     the synced accounts cache. Returns null when the session's
     account no longer exists — e.g. it was renamed or removed on
     the server (such as after the admin-email rebrand). */
  sessionAccount() {
    const s = readJSON(STORE_KEYS.session, null);
    if (!s || !s.email) return null;
    const users = readJSON(STORE_KEYS.users, []);
    return users.find(u => (u.email || '').toLowerCase() === String(s.email).toLowerCase()) || null;
  },
  /* Called by the admin-panel session watcher (script.js) only when
     the LOCAL session cache is missing or near its recorded expiry —
     checks whether the real underlying Supabase session is still
     live (the SDK auto-refreshes it silently while the tab is open)
     and, if so, re-mints the local cache from it instead of forcing
     a real sign-out. Returns true if it refreshed something, false
     if there's genuinely no live admin session to recover. No-op
     (returns false) in LOCAL mode — nothing to refresh against. */
  async tryRefreshAdminSession() {
    if (!REMOTE_MODE) return false;
    const { data } = await sb.auth.getSession();
    if (!data.session) return false;
    const users = readJSON(STORE_KEYS.users, []);
    const user = users.find(u => u.authUserId === data.session.user.id && u.role === 'admin');
    if (!user) return false;
    Store._mintAdminSession(user, data.session);
    return true;
  },
  isAdmin() {
    const s = Store.getSession();
    if (!s || s.role !== 'admin') return false;
    // Re-validate against the live account list: a cached "admin"
    // session is stale if its account was removed or demoted on
    // the server. If we have NO cached accounts (e.g. offline at
    // boot) trust the session rather than lock a real admin out;
    // only invalidate when the list is present and the account is
    // absent or no longer an admin.
    const users = readJSON(STORE_KEYS.users, []);
    if (!users.length) return true;
    const acct = users.find(u => (u.email || '').toLowerCase() === String(s.email).toLowerCase());
    return !!acct && acct.role === 'admin';
  },
  /* Role-agnostic staleness check used at boot for BOTH admin and
     customer sessions: true when there IS a session but its
     account is gone from the synced list (renamed/deleted on the
     server). Returns false when no accounts are cached (offline)
     so a real user isn't kicked out just because the list failed
     to load. */
  sessionStale() {
    const s = readJSON(STORE_KEYS.session, null);
    if (!s) return false;
    const users = readJSON(STORE_KEYS.users, []);
    if (!users.length) return false;
    return !users.find(u => (u.email || '').toLowerCase() === String(s.email).toLowerCase());
  },
  /* Derive 1–2 letter logo initials from the shop name so the
     brand mark follows a rebrand automatically — no hardcoded
     letters to chase. Prefers embedded capitals
     ("OrderInn Coffee" → "OI"), then word initials, then the
     first two letters. Pass nothing to use the current config. */
  brandInitials(name) {
    const s = String(name == null ? Store.getConfig().shopName : name || '').trim();
    if (!s) return 'OI';
    const caps = s.match(/[A-Z]/g);
    if (caps && caps.length >= 2) return (caps[0] + caps[1]).toUpperCase();
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return s.slice(0, 2).toUpperCase();
  },

  /* ==========================================================
     SEED — runs every boot.
     REMOTE mode: the default admin's real credential now lives in
     Supabase Auth (admin@orderinn.com was created once, manually, in
     the dashboard, and linked via auth_user_id — see
     data/admin-auth-migration.sql). There's no local hash left to
     force-sync; this just self-heals `role` if that row's local
     cache copy ever drifted, and is a no-op once the dashboard step
     is done and its bb_accounts row is correctly `role: 'admin'`.
     LOCAL mode (no Supabase configured): unchanged — force-syncs the
     admin1234 hash every boot so the app is always immediately
     usable standalone, exactly as before this migration.
     ========================================================== */
  async seedIfEmpty() {
    const SEED_ID    = 'u_seed_admin';
    const SEED_EMAIL = 'admin@orderinn.com';
    const users = await Store.getUsers();
    // Match by STABLE id first, falling back to email only for
    // legacy rows — id-matching survives a rebrand (email change)
    // without the app thinking the admin is gone and trying to
    // recreate it (which RLS would reject, jamming the sync queue).
    const existing = users.find(u => u.id === SEED_ID)
                  || users.find(u => (u.email || '').toLowerCase() === SEED_EMAIL.toLowerCase());

    if (REMOTE_MODE) {
      if (existing && existing.role !== 'admin') {
        existing.role = 'admin';
        writeJSON(STORE_KEYS.users, users);
        remoteUpsert('bb_accounts', USER_TO_ROW(existing));
      }
      return;
    }

    const SEED_PASSWORD = 'admin1234';
    const expectedHash = await hashPassword(SEED_PASSWORD);
    if (existing) {
      let changed = false;
      if (existing.role !== 'admin')      { existing.role = 'admin';       changed = true; }
      if (existing.passwordHash !== expectedHash) { existing.passwordHash = expectedHash; changed = true; }
      if (changed) writeJSON(STORE_KEYS.users, users);
      return;
    }

    const seed = {
      id:           SEED_ID,
      email:        SEED_EMAIL,
      passwordHash: expectedHash,
      name:         'Admin',
      role:         'admin',
      createdAt:    new Date().toISOString(),
    };
    users.push(seed);
    writeJSON(STORE_KEYS.users, users);
    console.info(`[Store] seeded default admin: ${SEED_EMAIL} / ${SEED_PASSWORD}`);
  },

  /* ==========================================================
     BOOT SEED — runs once per page load. Pulls accounts and
     products from data/*.json when localStorage is empty, so
     the same JSON files double as a future-proof DB export
     (importable into MySQL/MongoDB). seedIfEmpty() still runs
     after to guarantee the default admin exists.
     ========================================================== */
  async bootSeed() {
    // LOCAL mode (no SUPABASE_URL in config.js) — original behavior:
    // pull seeds from data/*.json once, then use localStorage.
    if (!REMOTE_MODE) {
      if (!localStorage.getItem(STORE_KEYS.menu)) {
        const seedMenu = await fetchJsonFile('data/products.json');
        if (Array.isArray(seedMenu) && seedMenu.length) {
          writeJSON(STORE_KEYS.menu, seedMenu);
        }
      }
      if (!localStorage.getItem(STORE_KEYS.users)) {
        const seedUsers = await fetchJsonFile('data/accounts.json');
        if (Array.isArray(seedUsers) && seedUsers.length) {
          writeJSON(STORE_KEYS.users, seedUsers);
        }
      }
      await Store.seedIfEmpty();
      return;
    }

    // REMOTE mode — pull authoritative state from Supabase and
    // mirror into localStorage so the rest of the Store API
    // (which reads synchronously from localStorage) still works.
    try {
      const [orders, products, configRow, users, logs] = await Promise.all([
        sb.from('bb_orders').select('*').order('placed_at', { ascending: false }).limit(500),
        sb.from('bb_products').select('*'),
        sb.from('bb_config').select('data').eq('id', 1).maybeSingle(),
        sb.from('bb_accounts').select('*'),
        sb.from('bb_activity').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      if (orders.data)   writeJSON(STORE_KEYS.orders, orders.data.map(ROW_TO_ORDER));
      if (products.data && products.data.length) {
        writeJSON(STORE_KEYS.menu, products.data.map(ROW_TO_PRODUCT));
      } else {
        // First-run: seed products table from the JSON file.
        // If the file fetch fails (e.g. opening index.html via
        // file://) we still have the in-code DEFAULT_MENU to
        // fall back on, so the customer never sees a blank
        // menu grid. The seed is then pushed to Supabase so
        // subsequent visits skip this path.
        let seedMenu = await fetchJsonFile('data/products.json');
        if (!Array.isArray(seedMenu) || !seedMenu.length) {
          console.warn('[Store] data/products.json unreachable — using built-in DEFAULT_MENU');
          seedMenu = DEFAULT_MENU;
        }
        writeJSON(STORE_KEYS.menu, seedMenu);
        const { error } = await sb.from('bb_products').upsert(
          seedMenu.map(PRODUCT_TO_ROW)
        );
        if (error) console.warn('[Store] supabase product seed failed', error);
        else        console.info(`[Store] seeded ${seedMenu.length} products into Supabase`);
      }
      if (configRow.data && configRow.data.data) {
        writeJSON(STORE_KEYS.config, { ...DEFAULT_CONFIG, ...configRow.data.data });
      }
      if (users.data)    writeJSON(STORE_KEYS.users, users.data.map(ROW_TO_USER));
      if (logs.data)     writeJSON(STORE_KEYS.log,   logs.data.map(ROW_TO_LOG));
    } catch (e) {
      console.warn('[Store] supabase initial fetch failed, falling back to local cache', e);
    }

    await Store.seedIfEmpty();
    syncServerClock();            // best-effort clock alignment (non-blocking)
    Store._wireRealtime();
  },

  /* Realtime subscription — Supabase pushes any INSERT/UPDATE/
     DELETE on the watched tables over a websocket. We patch the
     localStorage cache, then dispatch a synthetic `storage`
     event so the existing cross-tab refresh logic in script.js
     fires identically for remote changes. */
  _wireRealtime() {
    if (!REMOTE_MODE || Store._realtimeWired) return;
    Store._realtimeWired = true;

    /* Status callback: when ANY channel drops (CHANNEL_ERROR,
       TIMED_OUT, CLOSED) we flag the UI as 'error' so the
       sync-status badge turns red. The Supabase SDK auto-
       reconnects under the hood; when it succeeds the channel
       reports SUBSCRIBED and we flip back to 'idle'. The
       anti-entropy poller below also catches anything missed
       during the dropout. */
    const onStatus = (status) => {
      if (status === 'SUBSCRIBED')        setSyncState({ status: 'idle' });
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setSyncState({ status: 'error' });
      }
    };

    sb.channel('bb_orders_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bb_orders' }, (payload) => {
        const orders = Store.getOrders();
        if (payload.eventType === 'DELETE') {
          const filtered = orders.filter(o => o.id !== payload.old.id);
          writeJSON(STORE_KEYS.orders, filtered);
        } else {
          const incoming = ROW_TO_ORDER(payload.new);
          const idx = orders.findIndex(o => o.id === incoming.id);
          if (idx >= 0) orders[idx] = incoming;
          else          orders.unshift(incoming);
          writeJSON(STORE_KEYS.orders, orders);
        }
        Store._dispatchSync('bb_orders');
      })
      .subscribe(onStatus);

    sb.channel('bb_products_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bb_products' }, (payload) => {
        const menu = Store.getMenu();
        if (payload.eventType === 'DELETE') {
          writeJSON(STORE_KEYS.menu, menu.filter(m => m.id !== payload.old.id));
        } else {
          const item = ROW_TO_PRODUCT(payload.new);
          const idx  = menu.findIndex(m => m.id === item.id);
          if (idx >= 0) menu[idx] = item;
          else          menu.push(item);
          writeJSON(STORE_KEYS.menu, menu);
        }
        Store._dispatchSync('bb_menu');
      })
      .subscribe(onStatus);

    sb.channel('bb_config_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bb_config' }, (payload) => {
        if (payload.new && payload.new.data) {
          writeJSON(STORE_KEYS.config, { ...DEFAULT_CONFIG, ...payload.new.data });
          Store._dispatchSync('bb_config');
        }
      })
      .subscribe(onStatus);

    sb.channel('bb_activity_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bb_activity' }, (payload) => {
        const entry = ROW_TO_LOG(payload.new);
        const log   = Store.getLog();
        if (log.some(e => e.id === entry.id)) return;     // echo of our own write
        log.unshift(entry);
        if (log.length > 50) log.length = 50;
        Store.setLog(log);
        Store._dispatchSync('bb_activity_log');
      })
      .subscribe(onStatus);

    // Chat: surface new/removed messages to the UI via a custom
    // event (chat doesn't use the localStorage cache, so it
    // doesn't go through _dispatchSync).
    sb.channel('bb_messages_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bb_messages' }, (payload) => {
        observeServerTime(payload.new && payload.new.created_at);   // fresh insert ≈ server "now"
        window.dispatchEvent(new CustomEvent('bb-chat', { detail: { message: ROW_TO_MSG(payload.new) } }));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bb_messages' }, (payload) => {
        window.dispatchEvent(new CustomEvent('bb-chat-update', { detail: { message: ROW_TO_MSG(payload.new) } }));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'bb_messages' }, (payload) => {
        window.dispatchEvent(new CustomEvent('bb-chat-delete', { detail: { id: payload.old.id } }));
      })
      .subscribe(onStatus);

    console.info('[Store] realtime channels subscribed');

    /* S2 fix — anti-entropy poll. Every 30s while online,
       re-pull the recent orders and reconcile against the local
       cache. Catches anything that slipped through during a
       websocket dropout (mobile network switch, laptop sleep,
       etc.) without us having to detect the dropout itself. */
    setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        const { data, error } = await sb
          .from('bb_orders')
          .select('*')
          .order('placed_at', { ascending: false })
          .limit(200);
        if (error || !data) return;
        const incoming = data.map(ROW_TO_ORDER);
        const local    = Store.getOrders();
        let changed = false;
        // Patch in any rows we missed AND update statuses that
        // drifted (a status change we missed mid-disconnect).
        for (const inc of incoming) {
          const existing = local.find(l => l.id === inc.id);
          if (!existing) { local.unshift(inc); changed = true; }
          else if (existing.status !== inc.status || existing.servedAt !== inc.servedAt) {
            Object.assign(existing, inc); changed = true;
          }
        }
        if (changed) {
          Store.setOrders(local);
          Store._dispatchSync('bb_orders');
        }
      } catch {}
    }, 30 * 1000);
  },

  /* The browser's native `storage` event only fires in OTHER
     tabs of the same origin. Realtime updates arrive in THIS
     tab via the websocket, so we synthesize the same shape
     of event to feed the existing cross-tab listener in
     script.js — one code path handles both transports. */
  _dispatchSync(key) {
    try {
      window.dispatchEvent(new StorageEvent('storage', { key }));
    } catch {
      // Older browsers don't allow constructing StorageEvent — fall back to a custom event.
      window.dispatchEvent(new CustomEvent('bb-sync', { detail: { key } }));
    }
  },

  /* Register a new account — the LOCAL_MODE-only path (REMOTE mode
     uses sb.auth.signUp instead, see signupAdmin/signupCustomer).
     Used by LOCAL customer signup and by signupAdmin's LOCAL_MODE
     fallback (which passes skipInviteCheck:true since it already
     validated the code itself, before ever calling this). */
  async registerAccount({ email, name, password, role = 'admin', inviteCode, skipInviteCheck = false }) {
    email = String(email || '').trim().toLowerCase();
    name  = String(name  || '').trim();
    if (!email || !name || !password) throw new Error('Missing field');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address');
    // Account name rules: letters/numbers/underscore/dash only, 2–30
    // chars, no spaces and no "@" (so a name can't masquerade as an
    // email or break the chat sender label). Duplicate NAMES are fine;
    // only duplicate emails are blocked (below).
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(name)) {
      throw new Error('Name can use only letters, numbers, _ or - (2–30 chars, no spaces or @)');
    }
    if (password.length < 8)          throw new Error('Password must be at least 8 characters');

    // Customer self-signup never needs the invite code — that's
    // only there to gate ADMIN registration. Admins still need
    // the code unless an existing admin is creating them
    // (skipInviteCheck=true).
    if (!skipInviteCheck && role === 'admin') {
      const expected = Store.getInviteCode();
      if (!inviteCode || String(inviteCode).trim() !== expected) {
        throw new Error('Invalid invite code. Ask an existing admin for the current code.');
      }
    }

    const users = await Store.getUsers();
    if (users.some(u => u.email.toLowerCase() === email)) {
      throw new Error('An account with that email already exists');
    }
    const passwordHash = await hashPassword(password);
    const account = {
      id:        'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      email,
      name,
      role,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    users.push(account);
    writeJSON(STORE_KEYS.users, users);
    remoteUpsert('bb_accounts', USER_TO_ROW(account));
    return account;
  },

  /* ----- Real staff signup (Supabase Auth) -----
     Mirrors signupCustomer's two-outcome branch: REMOTE mode goes
     through sb.auth.signUp instead of registerAccount's client-side
     hash, so the credential never touches this device's localStorage
     as anything but a session cache. The invite code is checked
     client-side, against Store.getInviteCode(), BEFORE ever calling
     Supabase — same trust level as before, just moved earlier so a
     wrong code never starts a signUp call. LOCAL mode falls through
     to registerAccount exactly as it always has (skipInviteCheck:true
     since the code was already validated above). */
  async signupAdmin({ email, name, password, inviteCode }) {
    email = String(email || '').trim().toLowerCase();
    name  = String(name  || '').trim();
    if (!email || !name || !password) throw new Error('Missing field');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address');
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(name)) {
      throw new Error('Name can use only letters, numbers, _ or - (2–30 chars, no spaces or @)');
    }
    if (password.length < 8) throw new Error('Password must be at least 8 characters');

    const expected = Store.getInviteCode();
    if (!inviteCode || String(inviteCode).trim() !== expected) {
      throw new Error('Invalid invite code. Ask an existing admin for the current code.');
    }

    if (!REMOTE_MODE) {
      const account = await Store.registerAccount({ email, name, password, role: 'admin', inviteCode, skipInviteCheck: true });
      return { ...account, needsEmailConfirmation: false };
    }

    const { data, error } = await sb.auth.signUp({
      email, password, options: { data: { display_name: name } },
    });
    if (error) {
      throw new Error(/already registered|already exists/i.test(error.message)
        ? 'An account with that email already exists' : (error.message || 'Could not create account'));
    }
    // Same two outcomes as signupCustomer, depending on the project's
    // "Confirm email" Auth setting — see that function for detail.
    if (data.session) {
      const session = await Store._syncStaffFromAuthSession(data.session, inviteCode);
      return { ...session, needsEmailConfirmation: false };
    }
    return { id: null, email, name, needsEmailConfirmation: true };
  },

  /* ==========================================================
     CUSTOMER ACCOUNTS  (separate from admin/staff auth)
     - Customers sign in to earn points, redeem vouchers, and
       track loyalty toward free items.
     - Kept in its own STORE_KEYS.customer slot so a customer
       login never collides with an admin staff session on the
       same device.
     - Perks live on the account's `perks` jsonb so they follow
       the customer across devices (self-heals to local-only if
       the column hasn't been migrated yet — see data/customer-perks.sql).
     ========================================================== */
  LOYALTY_GOAL:  100,   // lifetime points per free muffin
  VOUCHER_COST:  50,    // spendable points to mint one discount voucher

  /* ----- Real customer auth (Supabase Auth) -----
     Customer sign-in/sign-up goes through Supabase Auth (email/
     password AND Google OAuth) instead of the old client-side
     password-hash compare — the hash never leaves Supabase, and a
     session can't be forged by pasting JSON into localStorage.

     bb_accounts.id stays the stable identity every other feature
     (orders, perks, profile) already joins on, so nothing downstream
     changes: _syncCustomerFromAuthSession() links/creates a
     bb_accounts row for the auth.users identity, then writes
     STORE_KEYS.customer with the SAME {id, email, name} shape
     Store.getCustomer() has always returned.

     LOCAL mode (no Supabase configured) falls back to the previous
     client-side hash check so the app still works standalone. */

  async signupCustomer({ email, name, password }) {
    email = String(email || '').trim().toLowerCase();
    name  = String(name  || '').trim();
    if (!email || !name || !password) throw new Error('Missing field');
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(name)) {
      throw new Error('Name can use only letters, numbers, _ or - (2–30 chars, no spaces or @)');
    }
    if (password.length < 8) throw new Error('Password must be at least 8 characters');

    if (!REMOTE_MODE) {
      const account = await Store.registerAccount({ email, name, password, role: 'customer' });
      return { ...account, needsEmailConfirmation: false };
    }

    const { data, error } = await sb.auth.signUp({
      email, password, options: { data: { display_name: name } },
    });
    if (error) {
      throw new Error(/already registered|already exists/i.test(error.message)
        ? 'An account with that email already exists' : (error.message || 'Could not create account'));
    }
    // Two possible outcomes depending on the project's Auth settings
    // (Supabase dashboard -> Authentication -> Providers -> Email ->
    // "Confirm email"):
    //   - OFF: signUp returns an active session immediately — link/
    //     create the bb_accounts row right away, caller is signed in.
    //   - ON (this project's current setting): no session yet: the
    //     account exists in auth.users but is unconfirmed. The caller
    //     must check their email and click the link before signing in.
    if (data.session) {
      await Store._syncCustomerFromAuthSession(data.session, name);
      return { ...Store.getCustomer(), needsEmailConfirmation: false };
    }
    return { id: null, email, name, needsEmailConfirmation: true };
  },

  async loginCustomer({ email, password }) {
    if (!REMOTE_MODE) {
      const users = await Store.getUsers();
      const user  = users.find(u => (u.email || '').toLowerCase() === String(email || '').toLowerCase());
      if (!user) throw new Error('No account found for that email');
      const hash = await hashPassword(password);
      if (hash !== user.passwordHash) throw new Error('Incorrect password');
      writeJSON(STORE_KEYS.customer, { id: user.id, email: user.email, name: user.name });
      const purged = await Store._purgeIfDeletionDue(user);
      if (purged) throw new Error('This account was permanently deleted after the 15-day grace period.');
      return { ...Store.getCustomer(), pendingDeletion: Store.deletionDaysLeft(user) };
    }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message === 'Invalid login credentials') throw new Error('Incorrect email or password');
      if (error.message === 'Email not confirmed') {
        throw new Error('Please confirm your email first — check your inbox for the link we sent.');
      }
      throw new Error(error.message || 'Sign-in failed');
    }
    const { pendingDeletion } = await Store._syncCustomerFromAuthSession(data.session);
    return { ...Store.getCustomer(), pendingDeletion };
  },

  /* Google sign-in — redirects the browser to Google, then back to
     index.html (the ordering page, where the signed-in experience
     lives — same landing spot signup.html already redirects to after
     a normal email/password signup). There's no return value: the
     redirect-back is handled by Store.resumeAuthSession() on the next
     page load (see boot() in script.js), which calls
     _syncCustomerFromAuthSession the same way the password path does. */
  async loginCustomerWithGoogle() {
    if (!REMOTE_MODE) throw new Error('Google sign-in requires Supabase to be configured');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: appUrl('index.html') },
    });
    if (error) throw new Error(error.message || 'Could not start Google sign-in');
  },

  /* "Forgot password" — sends a reset-link email via Supabase Auth.
     The link redirects back to index.html with a recovery session in
     the URL hash; resumeAuthSession() detects it (type=recovery) and
     boot() opens #resetPasswordModal so the customer can set a new
     password via completePasswordReset(). Always resolves the same
     generic message regardless of whether the email exists, so this
     can't be used to enumerate registered accounts. */
  async requestPasswordReset(email) {
    if (!REMOTE_MODE) throw new Error('Password reset requires Supabase to be configured');
    email = String(email || '').trim().toLowerCase();
    if (!email) throw new Error('Enter your email first');
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: appUrl('index.html'),
    });
    if (error) {
      // Supabase throttles repeat requests for the same user (the
      // "Minimum interval per user" SMTP setting) and returns 429. Its
      // message embeds the seconds left, e.g. "For security purposes,
      // you can only request this after 54 seconds." Surface a typed
      // error so the UI can show a friendly countdown instead of the
      // raw text. retryAfter is null when we can't parse a number.
      const isRate = error.status === 429 || /rate limit|after \d+ second|only request this/i.test(error.message || '');
      const secMatch = /after (\d+) second/i.exec(error.message || '');
      const e = new Error(error.message || 'Could not send the reset email');
      e.rateLimited = isRate;
      e.retryAfter = secMatch ? Number(secMatch[1]) : null;
      throw e;
    }
  },

  /* Sets a new password on the recovery session created by clicking
     the reset-link email. Only valid while that recovery session is
     active (see resumeAuthSession's recovery branch). */
  async completePasswordReset(newPassword) {
    if (!REMOTE_MODE) throw new Error('Password reset requires Supabase to be configured');
    if (!newPassword || newPassword.length < 8) throw new Error('Password must be at least 8 characters');
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message || 'Could not update password');
  },

  /* Call once on boot (after bootSeed). Picks up either: (a) a
     returning session Supabase Auth already restored from its own
     storage, or (b) a fresh session just delivered by the Google
     OAuth redirect-back — detected via the PKCE `?code=` param the
     SDK's default OAuth flow leaves in the URL, so the caller can
     tell "just signed in via Google" apart from "was already signed
     in" and only show a welcome toast / link guest orders for the
     former. No-op in LOCAL mode or when signed out. Returns
     { customer, freshOAuth: boolean }.

     If the STAFF_OAUTH_PARAM query param is present, this was a
     staff (not customer) Google round-trip — routes to
     _syncStaffFromAuthSession instead and reports it via `staff` on
     the result so boot() can prompt for an invite code
     (staffNeedsInviteCode) or drop straight into the admin panel
     (staffSession), instead of treating it as a customer sign-in. */
  async resumeAuthSession() {
    if (!REMOTE_MODE) return { customer: null, freshOAuth: false, pendingDeletion: null };
    const params = new URLSearchParams(location.search);
    const staffFlow = params.has(STAFF_OAUTH_PARAM);
    // Password-reset links can come back two ways depending on the flow:
    //   - implicit: #access_token=...&type=recovery  (in the hash)
    //   - PKCE / verify link: ?code=...&type=recovery (in the query)
    // Detect BOTH, and — critically — check recovery BEFORE treating a
    // ?code= as a normal returning sign-in, or the SDK exchanges the
    // code into a full session and logs the user straight in, silently
    // skipping the "set a new password" step.
    const hashRecovery  = /type=recovery/.test(location.hash);
    const queryRecovery = params.get('type') === 'recovery';
    const passwordRecovery = hashRecovery || queryRecovery;
    // A ?code= that's part of the recovery flow is NOT a fresh OAuth
    // sign-in — don't report it as one.
    const freshOAuth = params.has('code') && !passwordRecovery;

    // PKCE / verify-link recovery arrives as ?code=...&type=recovery.
    // The SDK's auto-detection may not have exchanged it yet by the time
    // we read the session, so do it explicitly — otherwise getSession()
    // returns null and the reset modal never opens.
    if (passwordRecovery && params.has('code')) {
      try { await sb.auth.exchangeCodeForSession(params.get('code')); } catch (_) {}
    }

    const { data } = await sb.auth.getSession();
    if (passwordRecovery && data.session) {
      return { customer: null, freshOAuth: false, pendingDeletion: null, passwordRecovery: true };
    }

    if (staffFlow) {
      if (!data.session) return { customer: null, freshOAuth: false, pendingDeletion: null, staff: null };
      try {
        // A code already collected + validated on register.html rides
        // along in the redirect URL so a brand-new sign-up isn't
        // prompted for it a second time; existing admins don't need
        // one, so this is undefined for the Staff Login modal's path.
        const staffSession = await Store._syncStaffFromAuthSession(data.session, params.get('inviteCode'));
        return { customer: null, freshOAuth: true, pendingDeletion: null, staff: { staffSession } };
      } catch (err) {
        if (err.needsInviteCode) {
          return { customer: null, freshOAuth: true, pendingDeletion: null,
                    staff: { staffNeedsInviteCode: true, pendingEmail: err.pendingEmail, authSession: data.session } };
        }
        sb.auth.signOut().catch(() => {});
        throw err;
      }
    }

    let pendingDeletion = null;
    if (data.session) ({ pendingDeletion } = await Store._syncCustomerFromAuthSession(data.session));
    return { customer: Store.getCustomer(), freshOAuth: freshOAuth && !!data.session, pendingDeletion };
  },

  /* Given an active Supabase Auth session, ensure a linked
     bb_accounts row exists (creating one on a customer's first
     sign-in) and populate STORE_KEYS.customer from it. `nameHint` is
     used only when creating a brand-new row (e.g. from signupCustomer,
     where the display name was just typed in); Google sign-ins fall
     back to the name Google provides, then the email's local part. */
  async _syncCustomerFromAuthSession(session, nameHint) {
    const authUser = session.user;
    if (!authUser) return { pendingDeletion: null };
    const users = await Store.getUsers();
    let account = users.find(u => u.authUserId === authUser.id);

    if (!account) {
      // First time this auth identity has been seen — link it to an
      // existing email-matched row (e.g. a legacy password-hash
      // account being upgraded) or create a fresh customer row.
      const email = (authUser.email || '').toLowerCase();
      account = users.find(u => (u.email || '').toLowerCase() === email && u.role === 'customer');
      const name = (nameHint || authUser.user_metadata?.full_name
        || authUser.user_metadata?.name || email.split('@')[0] || 'Guest')
        .trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'Guest';
      if (account) {
        account = { ...account, authUserId: authUser.id };
      } else {
        account = {
          id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          email, name, role: 'customer',
          authUserId: authUser.id,
          createdAt: new Date().toISOString(),
        };
      }
      const idx = users.findIndex(u => u.id === account.id);
      if (idx === -1) users.push(account); else users[idx] = account;
      writeJSON(STORE_KEYS.users, users);
      remoteUpsert('bb_accounts', USER_TO_ROW(account));
    }

    writeJSON(STORE_KEYS.customer, { id: account.id, email: account.email, name: account.name });

    // Enforce the 15-day grace period: if it has fully elapsed, purge
    // for good instead of completing sign-in.
    const purged = await Store._purgeIfDeletionDue(account);
    if (purged) {
      throw new Error('This account was permanently deleted after the 15-day grace period.');
    }
    return { pendingDeletion: Store.deletionDaysLeft(account) };
  },

  getCustomer()    { return readJSON(STORE_KEYS.customer, null); },
  logoutCustomer() {
    localStorage.removeItem(STORE_KEYS.customer);
    // Clear the real Supabase Auth session too (fire-and-forget — the
    // local state above is what the UI actually reacts to, so callers
    // don't need to await this). No-op in LOCAL mode.
    if (REMOTE_MODE) sb.auth.signOut().catch(() => {});
  },
  isCustomer()     { return !!Store.getCustomer(); },

  /* The signed-in customer's full account record (with perks). */
  _customerRecord() {
    const c = Store.getCustomer();
    if (!c) return null;
    return readJSON(STORE_KEYS.users, []).find(u => u.id === c.id) || null;
  },

  /* ==========================================================
     ACCOUNT DELETION  (15-day grace period)
     Deleting is a two-step, reversible process: requestAccountDeletion
     stamps deletionRequestedAt and signs the customer out (so a
     scheduled-for-deletion account can't keep placing orders /
     earning points); cancelAccountDeletion clears the stamp. The
     actual row purge only happens once the grace period has fully
     elapsed, and only opportunistically — see purgeIfDeletionDue().
     ========================================================== */
  DELETION_GRACE_DAYS: 15,

  /* Days remaining before a pending deletion becomes permanent (0 if
     due/overdue, null if no deletion is pending). */
  deletionDaysLeft(account) {
    const u = account || Store._customerRecord();
    if (!u || !u.deletionRequestedAt) return null;
    const elapsedMs = Date.now() - new Date(u.deletionRequestedAt).getTime();
    const leftMs = (Store.DELETION_GRACE_DAYS * 86400000) - elapsedMs;
    return Math.max(0, Math.ceil(leftMs / 86400000));
  },

  /* Stamp the signed-in customer's account for deletion and sign them
     out immediately. The row itself is untouched until the grace
     period elapses — signing back in within 15 days and cancelling
     is the recovery path. */
  async requestAccountDeletion() {
    const c = Store.getCustomer();
    if (!c) throw new Error('Not signed in');
    const users = readJSON(STORE_KEYS.users, []);
    const u = users.find(x => x.id === c.id);
    if (!u) throw new Error('Account not found');
    u.deletionRequestedAt = new Date().toISOString();
    writeJSON(STORE_KEYS.users, users);
    remoteUpsert('bb_accounts', USER_TO_ROW(u));
    Store.logoutCustomer();
    return u.deletionRequestedAt;
  },

  /* Cancel a pending deletion for the signed-in customer (used when
     they sign back in during the grace period and choose to stay). */
  async cancelAccountDeletion() {
    const c = Store.getCustomer();
    if (!c) throw new Error('Not signed in');
    const users = readJSON(STORE_KEYS.users, []);
    const u = users.find(x => x.id === c.id);
    if (!u || !u.deletionRequestedAt) return;
    u.deletionRequestedAt = null;
    writeJSON(STORE_KEYS.users, users);
    remoteUpsert('bb_accounts', USER_TO_ROW(u));
  },

  /* Opportunistic purge: if the signed-in account's grace period has
     fully elapsed, hard-delete it (remote row + local cache + auth
     identity) and sign out. There's no server cron in this project,
     so this is the enforcement point — it runs once per sign-in via
     _syncCustomerFromAuthSession. Returns true if a purge happened. */
  async _purgeIfDeletionDue(account) {
    if (!account || !account.deletionRequestedAt) return false;
    if (Store.deletionDaysLeft(account) > 0) return false;

    const users = readJSON(STORE_KEYS.users, []).filter(u => u.id !== account.id);
    writeJSON(STORE_KEYS.users, users);
    remoteDelete('bb_accounts', 'id', account.id);
    localStorage.removeItem(STORE_KEYS.customer);
    if (REMOTE_MODE) sb.auth.signOut().catch(() => {});
    return true;
  },

  /* Normalized perks for the signed-in customer (safe defaults). */
  getPerks() {
    const u = Store._customerRecord();
    const p = (u && u.perks) || {};
    return {
      points:         p.points         || 0,   // spendable
      lifetimePoints: p.lifetimePoints || 0,   // never spent — drives loyalty
      vouchers:       Array.isArray(p.vouchers) ? p.vouchers : [],
      awardedOrders:  Array.isArray(p.awardedOrders) ? p.awardedOrders : [],
      lifetimeSpend:  p.lifetimeSpend  || 0,    // total ₱ on completed orders → tiers
      spendLog:       Array.isArray(p.spendLog) ? p.spendLog : [],   // [{ ts, amount }]
      orderClientIds: Array.isArray(p.orderClientIds) ? p.orderClientIds : [],  // device ids whose orders belong to this account
    };
  },
  _savePerks(perks) {
    const c = Store.getCustomer();
    if (!c) return;
    const users = readJSON(STORE_KEYS.users, []);
    const u = users.find(x => x.id === c.id);
    if (!u) return;
    u.perks = perks;
    writeJSON(STORE_KEYS.users, users);
    remoteUpsert('bb_accounts', USER_TO_ROW(u));   // self-heals if `perks` column absent
  },
  /* Award points (raw). Bumps spendable balance + lifetime total. */
  addPoints(n) {
    if (!Store.getCustomer() || !n) return 0;
    const p = Store.getPerks();
    p.points         += n;
    p.lifetimePoints += n;
    Store._savePerks(p);
    return p.points;
  },
  /* Award points for a COMPLETED order — idempotent (only once per
     order id), so points are credited when an order is served, never
     at placement, and never twice. Returns points earned (0 if none). */
  awardOrderPoints(order) {
    if (!Store.getCustomer() || !order) return 0;
    const p = Store.getPerks();
    if (p.awardedOrders.includes(order.id)) return 0;
    const pts = Math.max(1, Math.floor((order.total || 0) / 10));   // ₱10 = 1 pt
    p.points         += pts;
    p.lifetimePoints += pts;
    p.awardedOrders.push(order.id);
    // Record the spend for tier progress + "spent this week" summaries.
    const amt = order.total || 0;
    p.lifetimeSpend += amt;
    p.spendLog.push({ ts: new Date().toISOString(), amount: amt });
    if (p.spendLog.length > 400) p.spendLog = p.spendLog.slice(-400);
    Store._savePerks(p);
    return pts;
  },
  /* Staff action: grant a discount voucher to ANY customer account
     by email (used by the admin panel). Writes to that account's
     perks, not the signed-in customer's. */
  async grantVoucher(email, discountPct) {
    const users = await Store.getUsers();
    const u = users.find(x => (x.email || '').toLowerCase() === String(email || '').toLowerCase());
    if (!u) throw new Error('No account with that email');
    const perks = u.perks || {};
    perks.vouchers = Array.isArray(perks.vouchers) ? perks.vouchers : [];
    const voucher = {
      code:        'V-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
      discountPct: Number(discountPct) || 10,
      createdAt:   new Date().toISOString(),
      used:        false,
      fromStaff:   true,
    };
    perks.vouchers.unshift(voucher);
    u.perks = perks;
    writeJSON(STORE_KEYS.users, users);
    remoteUpsert('bb_accounts', USER_TO_ROW(u));
    return voucher;
  },
  /* Spend points for a random-value discount voucher. */
  redeemVoucher() {
    const p = Store.getPerks();
    if (p.points < Store.VOUCHER_COST) {
      throw new Error(`Need ${Store.VOUCHER_COST} points — you have ${p.points}.`);
    }
    p.points -= Store.VOUCHER_COST;
    const pct = [5, 10, 15, 20][Math.floor(Math.random() * 4)];   // random discount
    const voucher = {
      code:        'V-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
      discountPct: pct,
      createdAt:   new Date().toISOString(),
      used:        false,
    };
    p.vouchers.unshift(voucher);
    Store._savePerks(p);
    return voucher;
  },
  /* Loyalty: a free muffin for every LOYALTY_GOAL lifetime points. */
  loyaltyStatus() {
    const { lifetimePoints } = Store.getPerks();
    const earned   = Math.floor(lifetimePoints / Store.LOYALTY_GOAL);
    const progress = lifetimePoints % Store.LOYALTY_GOAL;
    return { earned, progress, goal: Store.LOYALTY_GOAL };
  },

  /* Membership tiers by lifetime spend (₱). Thresholds chosen for a
     café: a few visits → Silver, a regular → Gold, a loyal local →
     Platinum. */
  TIERS: [
    { name: 'Bronze',   min: 0 },
    { name: 'Silver',   min: 1000 },
    { name: 'Gold',     min: 3000 },
    { name: 'Platinum', min: 7000 },
  ],
  tierStatus() {
    const spend = Store.getPerks().lifetimeSpend || 0;
    const tiers = Store.TIERS;
    let cur = tiers[0];
    for (const t of tiers) if (spend >= t.min) cur = t;
    const next = tiers[tiers.indexOf(cur) + 1] || null;
    const span = next ? (next.min - cur.min) : 1;
    return {
      name:      cur.name,
      spend,
      next:      next ? next.name : null,
      nextAt:    next ? next.min : null,
      remaining: next ? Math.max(0, next.min - spend) : 0,
      progress:  next ? Math.min(1, (spend - cur.min) / span) : 1,
    };
  },
  /* Rolling spend totals from the spend log, for the My Orders summary. */
  spendSummary() {
    const { spendLog, lifetimeSpend } = Store.getPerks();
    const now = Date.now(), DAY = 86400000;
    const since = (ms) => spendLog.reduce((s, e) =>
      (now - new Date(e.ts).getTime() <= ms ? s + (e.amount || 0) : s), 0);
    return { week: since(7 * DAY), month: since(30 * DAY), year: since(365 * DAY), lifetime: lifetimeSpend || 0 };
  },
  avgOrderValue() {
    const log = Store.getPerks().spendLog;
    if (!log.length) return 0;
    return log.reduce((s, e) => s + (e.amount || 0), 0) / log.length;
  },
  /* Tie this device's order client-ids to the signed-in customer so the
     orders they placed stay associated with the account after sign-out
     (the orders themselves persist in the store regardless). Called on
     logout, before the customer record is cleared. */
  rememberOrdersForAccount() {
    if (!Store.getCustomer()) return;
    const p = Store.getPerks();
    const ids = new Set([...(p.orderClientIds || []), ...Store.getMyClientIds()]);
    p.orderClientIds = [...ids].slice(0, 50);
    Store._savePerks(p);
  },
  /* On sign-in, look for the account's own still-active orders (under
     any client-id it owns) and re-adopt that id so the customer resumes
     them — no re-entry needed. Returns { clientId } or null when there's
     nothing active to resume. */
  resumeAccountOrders() {
    const p = Store.getPerks();
    const saved = new Set(p.orderClientIds || []);
    if (!saved.size) return null;
    const mine = Store.getOrders()
      .filter(o => saved.has(o.clientId) && (o.status === 'pending' || o.status === 'preparing'))
      .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));
    if (!mine.length) return null;
    const top = mine[0];
    Store.adoptClientId(top.clientId);
    return { clientId: top.clientId };
  },

  /* Staff invite code — single shared secret existing admins
     give to new hires so they can self-register. Stored inside
     the shared Supabase config row so every device sees the
     same code (was previously per-browser localStorage, which
     let any visitor self-mint a "valid" code on their own
     device). The local copy in bb_config still works as a cache
     for sync reads. */
  getInviteCode() {
    // Read from the cached config (populated by bootSeed in
    // remote mode, or set locally in local mode).
    const cfg = Store.getConfig();
    if (cfg && cfg.inviteCode) return cfg.inviteCode;
    // First-ever read — generate AND persist so this is the
    // last time we mint locally.
    return Store.rotateInviteCode();
  },
  rotateInviteCode() {
    const chunk = () => Math.random().toString(36).slice(2, 6).toUpperCase();
    const code  = `BB-${chunk()}-${chunk()}-${chunk()}`;
    // Persist via setConfig so the new code rides the same
    // remote-mirror path as the rest of the shop settings.
    Store.setConfig({ inviteCode: code });
    return code;
  },

  factoryReset() {
    Object.values(STORE_KEYS).forEach(k => localStorage.removeItem(k));
  },

  /* Full "reset everything to default" — a blank slate. Wipes orders,
     chat, activity, sessions, products, accounts, and config BOTH
     remotely (Supabase) and locally, then reseeds the default admin +
     default menu on the next boot. More thorough than factoryReset
     (which only clears this browser's localStorage); this also clears
     the shared backend so every device starts fresh. */
  async resetEverything() {
    if (REMOTE_MODE && navigator.onLine) {
      // PostgREST requires a filter on delete; `.neq(col,'')` matches
      // every row since no id/client_id is the empty string.
      const wipe = [
        sb.from('bb_orders').delete().neq('id', ''),
        sb.from('bb_messages').delete().neq('id', ''),
        sb.from('bb_activity').delete().neq('id', ''),
        sb.from('bb_sessions').delete().neq('client_id', ''),
        sb.from('bb_products').delete().neq('id', ''),
        sb.from('bb_accounts').delete().neq('id', ''),
        sb.from('bb_config').update({ data: {}, updated_at: new Date().toISOString() }).eq('id', 1),
      ];
      const results = await Promise.allSettled(wipe);
      results.forEach(r => { if (r.status === 'rejected') console.warn('[Store] reset remote step failed', r.reason); });
    }
    // Local: every tracked key plus the non-STORE_KEYS odds and ends.
    Object.values(STORE_KEYS).forEach(k => localStorage.removeItem(k));
    ['bb_chat_local', 'bossb_active_order', 'bb_chat_seen', 'bb_pin_hint_seen', 'bb_dismissed_orders']
      .forEach(k => localStorage.removeItem(k));
    // Reseed the default admin (and default menu in local mode) so the
    // shop is usable immediately after the reset.
    await Store.bootSeed();
  },
};

Store.isRemote = () => REMOTE_MODE;
Store.getSyncState = () => ({ ...syncState });
Store.onSyncChange = (fn) => { syncListeners.add(fn); fn(syncState); return () => syncListeners.delete(fn); };
Store.flushPending = flushPending;
/* Server-referenced "now" for relative timestamps that must agree
   across devices (chat). Falls back to the device clock until the
   first server time is observed. */
Store.serverNow = () => Date.now() + serverClockOffset;
Store.syncServerClock = syncServerClock;

/* ----------------------------------------------------------------
   CHAT PRESENCE + TYPING  (ephemeral, no table needed)
   Uses a Supabase Realtime channel per thread: presence tracks who
   is currently viewing the thread ("Active now"), and a broadcast
   event carries lightweight "typing…" pings. Both are transient —
   nothing is persisted, so no schema/RLS changes are required.
   ---------------------------------------------------------------- */
let _presenceCh = null, _presenceSelf = null;
Store.leaveChatPresence = () => {
  if (_presenceCh) { try { sb.removeChannel(_presenceCh); } catch (e) {} _presenceCh = null; }
  _presenceSelf = null;
};
/* Identity-based (NOT role-based) so behaviour is identical for every
   pairing — admin↔client, client↔admin, client↔client. The presence
   key + the `id` carried on presence/typing is this device's stable
   clientId; "other" is simply anyone whose id differs from mine. */
Store.joinChatPresence = ({ thread, role, name, onPresence, onTyping } = {}) => {
  if (!REMOTE_MODE || !thread) return () => {};
  Store.leaveChatPresence();
  const selfId = Store.getClientId();
  _presenceSelf = { id: selfId, role, name };
  const ch = sb.channel('chat-presence:' + thread, { config: { presence: { key: selfId } } });
  ch.on('presence', { event: 'sync' }, () => {
    try { onPresence && onPresence(ch.presenceState(), selfId); } catch (e) {}
  });
  ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
    try { onTyping && onTyping(payload || {}, selfId); } catch (e) {}
  });
  ch.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') { try { await ch.track({ id: selfId, role, name, at: Date.now() }); } catch (e) {} }
  });
  _presenceCh = ch;
  return () => Store.leaveChatPresence();
};
Store.sendTyping = () => {
  if (_presenceCh && _presenceSelf) {
    try { _presenceCh.send({ type: 'broadcast', event: 'typing', payload: { ..._presenceSelf, at: Date.now() } }); } catch (e) {}
  }
};
window.Store = Store;
window.DEFAULT_MENU = DEFAULT_MENU;
window.DEFAULT_CONFIG = DEFAULT_CONFIG;
