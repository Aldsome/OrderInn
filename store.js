/* ==========================================================
   BOSSB COFFEE SHOP — DATA STORE
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

   Default admin: admin@bossb.com / admin1234
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
};

/* How long a guest's name/table choice survives a refresh. After
   this window expires, the table prompt re-asks (so a different
   person at the same device picks their own name). Inactivity
   reset can also clear it earlier. */
const SESSION_TABLE_TTL_MS = 24 * 60 * 60 * 1000;
/* How recently another device must have been active for its name
   to count as a "live conflict" — prevents two people typing the
   same label at the same time, even before either has ordered. */
const ACTIVE_SESSION_TTL_MS = 30 * 60 * 1000;

/* Customer self-cancel grace window. During this period after
   placing, the customer sees a Cancel button in their orders
   popup — no admin involvement required. After it expires,
   only staff can cancel. */
const CANCEL_WINDOW_MS = 60 * 1000;

/* Combined cap for chat media (images + voice notes) stored
   inline in bb_messages. ~10% of the Supabase free DB (500 MB).
   When exceeded, the OLDEST media messages are deleted until
   back under the cap. */
const MEDIA_CAP_BYTES = 50 * 1024 * 1024;

/* ==========================================================
   DEFAULTS
   ========================================================== */
const DEFAULT_CONFIG = {
  shopName:    'BossB Coffee Shop',
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
  businessName:'BossB Coffee Shop',
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

const img = (topic, lock, w = 600, h = 420) =>
  `https://loremflickr.com/${w}/${h}/${encodeURIComponent(topic)}?lock=${lock}`;

const DEFAULT_MENU = [
  { id: 'c1', name: 'Classic Espresso',  category: 'coffee', price: 90,  emoji: '☕',
    desc: 'Bold double shot, rich crema.', tag: 'Bestseller',
    img: img('espresso,coffee', 101),
    options: { size: true, temp: false, milk: false, sugar: true } },
  { id: 'c2', name: 'Caramel Macchiato', category: 'coffee', price: 130, emoji: '☕',
    desc: 'Vanilla, caramel, layered milk.',
    img: img('caramel,latte', 102),
    options: { size: true, temp: true, milk: true, sugar: true } },
  { id: 'c3', name: 'Cafe Latte',        category: 'coffee', price: 120, emoji: '☕',
    desc: 'Smooth espresso with steamed milk.',
    img: img('latte,coffeeart', 103),
    options: { size: true, temp: true, milk: true, sugar: true } },
  { id: 'c4', name: 'Spanish Latte',     category: 'coffee', price: 135, emoji: '☕',
    desc: 'Condensed milk + espresso.',
    img: img('latte,coffee', 104),
    options: { size: true, temp: true, milk: true, sugar: true } },

  { id: 't1', name: 'Matcha Latte',      category: 'tea',    price: 140, emoji: '🍵',
    desc: 'Ceremonial matcha, vanilla cream.', tag: 'New',
    img: img('matcha,green,tea', 201),
    options: { size: true, temp: true, milk: true, sugar: true } },
  { id: 't2', name: 'Jasmine Green',     category: 'tea',    price: 100, emoji: '🍵',
    desc: 'Hand-picked jasmine blossoms.',
    img: img('greentea,teacup', 202),
    options: { size: true, temp: true, milk: false, sugar: true } },

  { id: 'b1', name: 'Cold Brew',         category: 'cold',   price: 130, emoji: '🧊',
    desc: '12-hour steep, smooth.',
    img: img('coldbrew,icedcoffee', 301),
    options: { size: true, temp: false, milk: true, sugar: true } },
  { id: 'b2', name: 'Iced Caramel',      category: 'cold',   price: 145, emoji: '🧊',
    desc: 'Iced espresso with caramel.',
    img: img('icedcoffee,caramel', 302),
    options: { size: true, temp: false, milk: true, sugar: true } },

  { id: 'p1', name: 'Butter Croissant',  category: 'pastry', price: 75,  emoji: '🥐',
    desc: 'Flaky, golden, baked daily.',
    img: img('croissant,bread', 401),
    options: { size: false, temp: false, milk: false, sugar: false } },
  { id: 'p2', name: 'Chocolate Cookie',  category: 'pastry', price: 55,  emoji: '🍪',
    desc: 'Gooey center, sea-salt finish.',
    img: img('cookie,chocolate', 402),
    options: { size: false, temp: false, milk: false, sugar: false } },
  { id: 'p3', name: 'Strawberry Tart',   category: 'pastry', price: 110, emoji: '🍰',
    desc: 'Vanilla custard, fresh berries.',
    img: img('tart,strawberry', 403),
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

/* Row ↔ JS object mapping. Postgres tables use snake_case;
   the in-memory app uses camelCase, mirroring the JSON file
   shape. Centralised here so the rest of the store doesn't
   need to know about either side. */
const ROW_TO_ORDER = (r) => r && ({
  id:          r.id,
  number:      r.number,
  tableNumber: r.table_number,
  clientId:    r.client_id,
  items:       r.items,
  total:       Number(r.total),
  notes:       r.notes || '',
  status:      r.status,
  placedAt:    r.placed_at,
  servedAt:    r.served_at,
  cancelledAt: r.cancelled_at,
  cancelledBy: r.cancelled_by,
  joinPin:     r.join_pin || null,
});
const ORDER_TO_ROW = (o) => ({
  id:           o.id,
  number:       o.number,
  table_number: o.tableNumber || null,
  client_id:    o.clientId,
  items:        o.items,
  total:        o.total,
  notes:        o.notes || '',
  status:       o.status,
  placed_at:    o.placedAt,
  served_at:    o.servedAt,
  cancelled_at: o.cancelledAt || null,
  cancelled_by: o.cancelledBy || null,
  join_pin:     o.joinPin || null,
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
});
const USER_TO_ROW = (u) => ({
  id:            u.id,
  email:         u.email,
  name:          u.name,
  role:          u.role,
  password_hash: u.passwordHash,
  created_at:    u.createdAt,
});
const ROW_TO_MSG = (r) => r && ({
  id:         r.id,
  thread:     r.table_label,
  sender:     r.sender,
  senderName: r.sender_name,
  role:       r.role,
  kind:       r.kind,
  body:       r.body,
  sizeBytes:  r.size_bytes || 0,
  ts:         r.created_at,
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
});
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

/* Replay all queued writes. Stops on the first failure so we
   preserve order. Called on every successful remote write, on
   the `online` browser event, and on a 20s timer. */
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
function remoteDelete(table, idCol, id) {
  if (!REMOTE_MODE) return Promise.resolve();
  if (!navigator.onLine) {
    queuePending({ table, op: 'delete', payload: { _delCol: idCol, _delId: id } });
    setSyncState({ status: 'offline' });
    return Promise.resolve();
  }
  return sb.from(table).delete().eq(idCol, id).then(({ error }) => {
    if (error) {
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

  async placeOrder({ tableNumber, items, notes }) {
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
    // Table join PIN — minted by the FIRST order at a table label,
    // then inherited by every later order at the same table (the
    // owner's repeats and anyone who joined via the PIN gate). This
    // is what the "Join this table" gate checks against. When the
    // table's orders are all served/cleared, the next first order
    // mints a fresh PIN, so a freed table can't be joined with a
    // stale code.
    const activeAtTable = Store.findActiveOrdersByTable(tableNumber);
    const existingPin   = activeAtTable.map(o => o.joinPin).find(Boolean);
    const joinPin       = existingPin || String(Math.floor(1000 + Math.random() * 9000));
    const order = {
      id:          'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      number,
      tableNumber: tableNumber || null,
      clientId:    Store.getClientId(),       // ties this order to the browser that placed it
      items,                                  // each: { itemId, name, qty, unitPrice, config }
      total:       items.reduce((s, i) => s + i.unitPrice * i.qty, 0),
      notes:       notes || '',
      status:      'pending',
      placedAt:    new Date().toISOString(),
      servedAt:    null,
      joinPin,                                // table-join PIN (see above)
    };
    const orders = Store.getOrders();
    orders.unshift(order);                    // newest first
    Store.setOrders(orders);
    remoteUpsert('bb_orders', ORDER_TO_ROW(order));
    // Monotonic lifetime tally (daily numbers reset; this doesn't).
    Store.setConfig({ lifetimeOrders: (Store.getConfig().lifetimeOrders || 0) + 1 });
    Store.pushLog({
      type:    'order_placed',
      message: `Order #${order.number} placed at ${order.tableNumber || '—'}`,
      orderId: order.id,
    });
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
     customer "Modify" flow (within the grace window) and the admin
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
     still pending AND within the grace window. Returns the order
     so the caller can restore the items into the cart. */
  customerCancelOrder(orderId) {
    const orders = Store.getOrders();
    const o = orders.find(x => x.id === orderId);
    if (!o)                       return { ok: false, reason: 'not_found' };
    if (o.status !== 'pending')   return { ok: false, reason: 'already_started' };
    if (!Store.isCancellableByCustomer(o)) return { ok: false, reason: 'window_expired' };
    o.status = 'cancelled';
    o.cancelledBy = 'customer';
    o.cancelledAt = new Date().toISOString();
    Store.setOrders(orders);
    remoteUpsert('bb_orders', ORDER_TO_ROW(o));
    Store.pushLog({
      type:    'order_status',
      status:  'cancelled',
      message: `Order #${o.number} cancelled by customer (within grace window)`,
      orderId: o.id,
    });
    return { ok: true, order: o };
  },

  isCancellableByCustomer(order) {
    if (!order || order.status !== 'pending') return false;
    const placed = new Date(order.placedAt).getTime();
    return (Date.now() - placed) < CANCEL_WINDOW_MS;
  },

  /* Milliseconds remaining until the grace window expires, or 0
     if it already has / the order isn't pending. */
  cancelWindowRemaining(order) {
    if (!order || order.status !== 'pending') return 0;
    const placed = new Date(order.placedAt).getTime();
    return Math.max(0, CANCEL_WINDOW_MS - (Date.now() - placed));
  },

  /* All orders this browser has placed that haven't been
     "dismissed" by the customer (served+acknowledged or deleted).
     Used to drive the customer's "My orders" popup. */
  getMyOrders() {
    const cid = Store.getClientId();
    return Store.getOrders().filter(o => o.clientId === cid);
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
  /* Past client ids for THIS browser (newest first), capped at 10. */
  getClientIdHistory() { return readJSON(STORE_KEYS.clientHistory, []); },
  /* Current id plus every past id this browser has held — the set
     that all "is this the same device/person?" checks should use
     (everything except getMyOrders, which stays scoped to current). */
  getMyClientIds() { return [Store.getClientId(), ...Store.getClientIdHistory()]; },

  /* ==========================================================
     SESSION TABLE  (24h guest label persistence)
     - Survives page refresh: the visitor isn't re-asked just
       because they reloaded.
     - Expires after 24h, OR sooner if inactivity reset clears
       it, so a different person at the same device the next
       day gets a fresh prompt.
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
      if ((all[cid].name || '').trim().toLowerCase() === needle) return cid;
    }
    return null;
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
      const { data, error } = await sb
        .from('bb_sessions')
        .select('client_id, name, last_active')
        .ilike('name', needle)
        .gt('last_active', cutoff);
      if (error || !data) return null;
      const hit = data.find(r =>
        r.client_id !== myId &&
        String(r.name || '').trim().toLowerCase() === needle
      );
      return hit ? hit.client_id : null;
    } catch (e) {
      return null;   // network hiccup — fail open, don't block ordering
    }
  },
  bumpActiveSession(name) {
    if (!name) { Store.dropActiveSession(); return; }
    const all = Store._readSessions();
    all[Store.getClientId()] = { name, lastActive: Date.now() };
    writeJSON(STORE_KEYS.activeSessions, all);
    // Mirror to Supabase so other devices can see this claim.
    // Best-effort presence data — no retry queue (a missed
    // heartbeat just makes the row look stale, which is fine).
    if (REMOTE_MODE && navigator.onLine) {
      sb.from('bb_sessions').upsert({
        client_id:   Store.getClientId(),
        name,
        last_active: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) console.warn('[Store] session upsert failed', error);
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
  async sendMessage({ thread, role, senderName, kind, body }) {
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
    };
    if (REMOTE_MODE && navigator.onLine) {
      const { error } = await sb.from('bb_messages').insert(MSG_TO_ROW(msg));
      if (error) { console.warn('[Store] message insert failed', error); throw error; }
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

  async login({ email, password }) {
    const users = await Store.getUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) throw new Error('No account found for that email');
    const hash = await hashPassword(password);
    if (hash !== user.passwordHash) throw new Error('Incorrect password');
    if (user.role !== 'admin')      throw new Error('Staff access only');

    const session = {
      email:     user.email,
      name:      user.name,
      role:      user.role,
      issuedAt:  Date.now(),
      expiresAt: Date.now() + (1000 * 60 * 60 * 8),
    };
    writeJSON(STORE_KEYS.session, session);
    return session;
  },

  logout()        { localStorage.removeItem(STORE_KEYS.session); },
  getSession()    {
    const s = readJSON(STORE_KEYS.session, null);
    if (!s)                          return null;
    if (s.expiresAt < Date.now()) { Store.logout(); return null; }
    return s;
  },
  isAdmin() {
    const s = Store.getSession();
    return !!s && s.role === 'admin';
  },

  /* ==========================================================
     SEED — runs every boot; guarantees the default admin
     exists with the default password.
     ========================================================== */
  async seedIfEmpty() {
    const SEED_EMAIL    = 'admin@bossb.com';
    const SEED_PASSWORD = 'admin1234';
    const users = await Store.getUsers();
    const expectedHash = await hashPassword(SEED_PASSWORD);
    const existing = users.find(u => u.email === SEED_EMAIL);

    if (existing) {
      let changed = false;
      if (existing.role !== 'admin')      { existing.role = 'admin';       changed = true; }
      if (existing.passwordHash !== expectedHash) { existing.passwordHash = expectedHash; changed = true; }
      if (changed) writeJSON(STORE_KEYS.users, users);
      return;
    }

    const seed = {
      id:           'u_seed_admin',
      email:        SEED_EMAIL,
      passwordHash: expectedHash,
      name:         'Admin',
      role:         'admin',
      createdAt:    new Date().toISOString(),
    };
    users.push(seed);
    writeJSON(STORE_KEYS.users, users);
    remoteUpsert('bb_accounts', USER_TO_ROW(seed));
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
        window.dispatchEvent(new CustomEvent('bb-chat', { detail: { message: ROW_TO_MSG(payload.new) } }));
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

  /* Register a new account. Used by register.html (which must
     include a valid inviteCode) and by the admin Settings
     "Add staff" button (which calls with skipInviteCheck=true
     because the caller is already an authenticated admin). */
  async registerAccount({ email, name, password, role = 'admin', inviteCode, skipInviteCheck = false }) {
    email = String(email || '').trim().toLowerCase();
    name  = String(name  || '').trim();
    if (!email || !name || !password) throw new Error('Missing field');
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
window.Store = Store;
window.DEFAULT_MENU = DEFAULT_MENU;
window.DEFAULT_CONFIG = DEFAULT_CONFIG;
window.CANCEL_WINDOW_MS = CANCEL_WINDOW_MS;
