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
  menu:    'bb_menu',
  orders:  'bb_orders',
  config:  'bb_config',
  users:   'bb_users',
  session: 'bb_session',
};

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
      items,                                  // each: { itemId, name, qty, unitPrice, config }
      total:       items.reduce((s, i) => s + i.unitPrice * i.qty, 0),
      notes:       notes || '',
      status:      'pending',
      placedAt:    new Date().toISOString(),
      servedAt:    null,
    };
    orders.unshift(order);                    // newest first
    Store.setOrders(orders);
    return order;
  },

  updateOrderStatus(orderId, status) {
    const orders = Store.getOrders();
    const o = orders.find(x => x.id === orderId);
    if (!o) return false;
    o.status = status;
    if (status === 'served') o.servedAt = new Date().toISOString();
    return Store.setOrders(orders);
  },

  deleteOrder(orderId) {
    return Store.setOrders(Store.getOrders().filter(o => o.id !== orderId));
  },

  clearServedOrders() {
    return Store.setOrders(Store.getOrders().filter(o => o.status !== 'served'));
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
