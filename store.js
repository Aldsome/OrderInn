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
  menu:     'bb_menu',
  orders:   'bb_orders',
  config:   'bb_config',
  users:    'bb_users',
  session:  'bb_session',
  client:   'bb_client_id',     // per-browser anonymous id, lets us track
                                 // "my orders" for the customer without accounts
  log:      'bb_activity_log',  // admin-facing changelog (last 50 entries)
  logSeen:  'bb_log_seen',      // last activity id the admin has seen
};

/* Customer self-cancel grace window. During this period after
   placing, the customer sees a Cancel button in their orders
   popup — no admin involvement required. After it expires,
   only staff can cancel. */
const CANCEL_WINDOW_MS = 60 * 1000;

/* ==========================================================
   DEFAULTS
   ========================================================== */
const DEFAULT_CONFIG = {
  shopName: 'BossB Coffee Shop',
  tagline:  'Freshly brewed, locally loved.',
  currency: '₱',
  tables:   12,
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
    img: img('latte,spanish', 104),
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
    return Store.setMenu(menu);
  },
  deleteMenuItem(id) {
    return Store.setMenu(Store.getMenu().filter(m => m.id !== id));
  },

  /* ----- Config ----- */
  getConfig()       { return { ...DEFAULT_CONFIG, ...readJSON(STORE_KEYS.config, {}) }; },
  setConfig(patch)  { return writeJSON(STORE_KEYS.config, { ...Store.getConfig(), ...patch }); },
  resetConfig()     { localStorage.removeItem(STORE_KEYS.config); },

  /* ==========================================================
     ORDERS
     - Statuses: 'pending' (just placed, waiting for staff)
                 'preparing' (barista is making it)
                 'served'   (delivered to table, complete)
                 'cancelled'
     ========================================================== */
  getOrders()      { return readJSON(STORE_KEYS.orders, []); },
  setOrders(o)     { return writeJSON(STORE_KEYS.orders, o); },

  placeOrder({ tableNumber, items, notes }) {
    const orders = Store.getOrders();
    const number = orders.length === 0
      ? 1
      : Math.max(...orders.map(o => o.number)) + 1;
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
    };
    orders.unshift(order);                    // newest first
    Store.setOrders(orders);
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
    const prev = o.status;
    o.status = status;
    if (status === 'served') o.servedAt = new Date().toISOString();
    Store.setOrders(orders);
    Store.pushLog({
      type:    'order_status',
      status,
      message: `Order #${o.number} (${o.tableNumber || '—'}): ${prev} → ${status}`,
      orderId: o.id,
    });
    return true;
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
    const o = Store.getOrders().find(x => x.id === orderId);
    const ok = Store.setOrders(Store.getOrders().filter(x => x.id !== orderId));
    if (o) Store.pushLog({
      type:    'order_delete',
      message: `Order #${o.number} (${o.tableNumber || '—'}) deleted`,
      orderId: o.id,
    });
    return ok;
  },

  clearServedOrders() {
    const n = Store.getOrders().filter(o => o.status === 'served').length;
    const ok = Store.setOrders(Store.getOrders().filter(o => o.status !== 'served'));
    if (n > 0) Store.pushLog({
      type:    'order_delete',
      message: `Cleared ${n} served order${n === 1 ? '' : 's'}`,
    });
    return ok;
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
    log.unshift({ id, ts: new Date().toISOString(), ...entry });
    if (log.length > 50) log.length = 50;
    Store.setLog(log);
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

  /* Menu upsert/delete with log entries so the admin can see
     "Saved 'Latte'" / "Deleted 'Cookie'" in their feed. */
  upsertMenuItemLogged(item) {
    const existing = Store.getMenu().find(m => m.id === item.id);
    Store.upsertMenuItem(item);
    Store.pushLog({
      type:    existing ? 'menu_save' : 'menu_add',
      message: `${existing ? 'Updated' : 'Added'} menu item "${item.name}"`,
    });
  },
  deleteMenuItemLogged(id) {
    const existing = Store.getMenu().find(m => m.id === id);
    Store.deleteMenuItem(id);
    if (existing) Store.pushLog({
      type:    'menu_delete',
      message: `Deleted menu item "${existing.name}"`,
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

    users.push({
      email:        SEED_EMAIL,
      passwordHash: expectedHash,
      name:         'Admin',
      role:         'admin',
      createdAt:    new Date().toISOString(),
    });
    writeJSON(STORE_KEYS.users, users);
    console.info(`[Store] seeded default admin: ${SEED_EMAIL} / ${SEED_PASSWORD}`);
  },

  factoryReset() {
    Object.values(STORE_KEYS).forEach(k => localStorage.removeItem(k));
  },
};

window.Store = Store;
window.DEFAULT_MENU = DEFAULT_MENU;
window.DEFAULT_CONFIG = DEFAULT_CONFIG;
window.CANCEL_WINDOW_MS = CANCEL_WINDOW_MS;
