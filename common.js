/* ==========================================================
   ORDERINN COFFEE — COMMON
   Shared foundation loaded by BOTH the customer (index.html) and
   admin (admin.html) pages: DOM helpers, option catalog, format
   helpers, theme, toast, and config-to-DOM. Loads after store.js,
   before the page-specific script.
   ========================================================== */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* Run a re-render without letting it shift the scroll position.
   Category/sort switches rebuild list HTML whose height changes,
   which would otherwise jump the page (window) or the admin scroll
   box. We snapshot the scroll offset, re-render, then restore it.
   Direct scrollTop assignment is instant (CSS scroll-behavior:smooth
   only affects scrollTo/scrollIntoView), so there's no animation. */
function withScrollAnchor(el, fn) {
  const win = !el || el === window;
  const node = win ? document.scrollingElement || document.documentElement : el;
  const top = node.scrollTop;
  fn();
  // Restore on the next frame too, in case async layout (images)
  // nudged it; the synchronous set covers the common case.
  node.scrollTop = top;
  requestAnimationFrame(() => { node.scrollTop = top; });
}

/* ==========================================================
   OPTION CATALOG  (shared)
   ========================================================== */
const SIZES = [
  { id: 'sm', label: 'Small  (12oz)', delta: -10 },
  { id: 'md', label: 'Medium (16oz)', delta:   0, default: true },
  { id: 'lg', label: 'Large  (22oz)', delta: +20 },
];
const TEMPS = [
  { id: 'hot', label: 'Hot',  delta: 0, default: true },
  { id: 'ice', label: 'Iced', delta: +10 },
];
const MILKS = [
  { id: 'regular', label: 'Whole milk',  delta:   0, default: true },
  { id: 'oat',     label: 'Oat milk',    delta: +20 },
  { id: 'almond',  label: 'Almond milk', delta: +20 },
  { id: 'soy',     label: 'Soy milk',    delta: +15 },
  { id: 'none',    label: 'No milk',     delta:  -5 },
];
const SUGAR = [
  { id: '0',   label: '0%',   delta: 0 },
  { id: '25',  label: '25%',  delta: 0 },
  { id: '50',  label: '50%',  delta: 0, default: true },
  { id: '75',  label: '75%',  delta: 0 },
  { id: '100', label: '100%', delta: 0 },
];

let MENU   = Store.getMenu();
let CONFIG = Store.getConfig();

/* ==========================================================
   FORMAT HELPERS
   ========================================================== */
const peso = (n) => `${CONFIG.currency}${Number(n).toFixed(2)}`;
const getOpt = (list, id) => list.find(o => o.id === id);

/* ==========================================================
   PRODUCT IMAGE RESOLVER  (dynamic, keyword-driven)
   ----------------------------------------------------------
   A product's photo is resolved at RENDER time from its name +
   category, so ANY item an admin adds gets a sensible café photo
   with no per-item hand-picking. Order of resolution:

     1. An explicit item.img (admin-set) always wins — intentional
        beats inferred.
     2. Otherwise match the name against a curated keyword→photo
        map of verified Unsplash shots. Longer/more-specific
        keywords are tried first ("cold brew" before "coffee") so
        the closest match wins.
     3. Otherwise fall back to a known-good photo for the item's
        category.
     4. Otherwise (no match, no category) the emoji placeholder in
        thumbMarkup shows.

   Every URL here is a stable Unsplash CDN link, verified to load
   and to actually depict the subject — no keyword-lottery service
   that can return an off-topic image.
   ========================================================== */
const UNSPLASH = (id, w = 600, h = 420) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&crop=entropy&q=80`;

/* Curated keyword → photo. Keys are lowercase substrings matched
   against the product name. Ordered by specificity (most specific
   first) via PRODUCT_IMAGE_ORDER below. */
const PRODUCT_IMAGE_MAP = {
  // --- specific drinks (checked before generic "coffee"/"tea") ---
  'cold brew':    '1517701550927-30cf4ba1dba5',
  'iced caramel': '1461023058943-07fcbe16d735',
  'iced':         '1461023058943-07fcbe16d735',
  'caramel':      '1572442388796-11668a67e53d',
  'macchiato':    '1572442388796-11668a67e53d',
  'spanish':      '1541167760496-1628856ab772',
  'cappuccino':   '1517256064527-09c73fc73e38',
  'americano':    '1551030173-122aabc4489c',
  'espresso':     '1510707577719-ae7c14805e3a',
  'mocha':        '1578374173705-969cbe6f2d6b',
  'flat white':   '1517256064527-09c73fc73e38',
  'latte':        '1503481766315-7a586b20f66d',
  'matcha':       '1536256263959-770b48d82b0a',
  'jasmine':      '1627435601361-ec25f5b1d0e5',
  'green tea':    '1627435601361-ec25f5b1d0e5',
  'chai':         '1571934811356-5cc061b6821f',
  'tea':          '1627435601361-ec25f5b1d0e5',
  'chocolate':    '1499636136210-6f4ee915583e',
  'cookie':       '1499636136210-6f4ee915583e',
  'croissant':    '1555507036-ab1f4038808a',
  'muffin':       '1607958996333-41aef7caefaa',
  'cake':         '1565958011703-44f9829ba187',
  'tart':         '1565958011703-44f9829ba187',
  'strawberry':   '1565958011703-44f9829ba187',
  'bread':        '1509440159596-0249088772ff',
  'sandwich':     '1528735602780-2552fd46c7af',
  'donut':        '1551024601-bec78aea704b',
  'coffee':       '1447933601403-0c6688de566e',
};
/* Try longer keys first so "cold brew" wins over "coffee", etc. */
const PRODUCT_IMAGE_ORDER = Object.keys(PRODUCT_IMAGE_MAP)
  .sort((a, b) => b.length - a.length);

/* One reliable photo per category as the mid-tier fallback. */
const CATEGORY_IMAGE = {
  coffee: '1447933601403-0c6688de566e',
  tea:    '1627435601361-ec25f5b1d0e5',
  cold:   '1517701550927-30cf4ba1dba5',
  pastry: '1509440159596-0249088772ff',
};

/* Legacy seed URLs (loremflickr's keyword lottery) are NOT
   intentional admin choices — they're the stale source of the
   mismatched images we're fixing. Treat them as unset so the
   resolver replaces them, while still honoring any real URL an
   admin pasted. */
function isLegacySeedImg(url) {
  return /loremflickr\.com|source\.unsplash\.com|placeimg\.com|lorempixel/i.test(url);
}

function resolveProductImage(item) {
  if (!item) return '';
  if (item.img && !isLegacySeedImg(item.img)) return item.img;  // real admin-set wins
  const name = String(item.name || '').toLowerCase();
  for (const key of PRODUCT_IMAGE_ORDER) {
    if (name.includes(key)) return UNSPLASH(PRODUCT_IMAGE_MAP[key]);
  }
  const catId = CATEGORY_IMAGE[String(item.category || '').toLowerCase()];
  if (catId) return UNSPLASH(catId);
  return '';                                           // → emoji fallback
}

/* Thumbnail markup — show the product image when present; the emoji
   only appears as a fallback when there is NO image (or it fails to
   load), so it never overlays a real photo. The fallback starts
   hidden whenever an image exists and is revealed by the img's
   onerror handler. */
function thumbMarkup(item, opts = {}) {
  const cls     = opts.fallbackClass || 'ph-fallback';
  const extra   = opts.fallbackStyle || '';
  const loading = opts.loading || 'lazy';
  const emoji   = (item && item.emoji) || '☕';
  // Resolve the photo dynamically from name/category (admin-set img
  // still wins) so any product gets a matching café shot, not just
  // the seeded ones. See resolveProductImage above.
  const src = resolveProductImage(item);
  if (src) {
    const hide = ['display:none', extra].filter(Boolean).join(';');
    return `<img src="${src}" alt="${escapeHtml(opts.alt || '')}" loading="${loading}" `
      + `onerror="this.style.display='none';var f=this.parentNode.querySelector('.${cls}');if(f)f.style.display='';">`
      + `<span class="${cls}" style="${hide}">${emoji}</span>`;
  }
  return `<span class="${cls}"${extra ? ` style="${extra}"` : ''}>${emoji}</span>`;
}

/* ----- Option groups (built-in + admin-defined custom) -----
   The four built-ins keep their bespoke choice lists; custom groups
   come from Store.getOptionGroups(). optionDefs() unifies them so the
   pricing / line-key / summary / customizer code treats every option
   group the same way and isn't hardcoded to milk/sugar/etc. */
const BUILTIN_OPTION_DEFS = [
  { key: 'size',  label: 'Size',     list: SIZES },
  { key: 'temp',  label: 'Hot/Iced', list: TEMPS },
  { key: 'milk',  label: 'Milk',     list: MILKS },
  { key: 'sugar', label: 'Sugar',    list: SUGAR },
];
function optionDefs() {
  return BUILTIN_OPTION_DEFS.concat(
    Store.getOptionGroups().map(g => ({
      key: g.id, label: g.label, list: g.choices || [], custom: true,
    }))
  );
}
const optionDef = (key) => optionDefs().find(d => d.key === key);

function defaultConfigFor(item) {
  const o = item.options || {};
  const config = { notes: '' };
  for (const def of optionDefs()) {
    if (!o[def.key]) continue;
    config[def.key] = (def.list.find(c => c.default)?.id) || def.list[0]?.id || null;
  }
  // Preserve the legacy marker: when the Hot/Iced toggle is OFF, a
  // cold-category drink still carries an inert 'ice' temp (when the
  // toggle is ON the loop above already set the list default).
  if (item.category === 'cold' && !o.temp) config.temp = 'ice';
  return config;
}
function unitPrice(item, config) {
  let p = item.price;
  const o = item.options || {};
  for (const def of optionDefs()) {
    if (!o[def.key] || !config[def.key]) continue;
    p += getOpt(def.list, config[def.key])?.delta || 0;
  }
  return p;
}
/* Stable cart line key: item id + every set option selection (sorted
   so order is deterministic) + notes. Format is internal to the cart
   only (never persisted), so generalising it is safe. */
function lineKeyOf(itemId, config) {
  const keys = Object.keys(config).filter(k => k !== 'notes').sort();
  return [itemId, ...keys.map(k => `${k}:${config[k] ?? '_'}`),
    (config.notes || '').trim().toLowerCase()].join('|');
}
function configSummary(item, config) {
  const bits = [];
  const o = item.options || {};
  for (const def of optionDefs()) {
    if (!o[def.key] || !config[def.key]) continue;
    const choice = getOpt(def.list, config[def.key]);
    if (!choice) continue;
    if (def.key === 'size')       bits.push(choice.label.split(/\s+/)[0]);
    else if (def.key === 'milk') { if (config.milk !== 'regular') bits.push(choice.label); }
    else if (def.key === 'sugar') bits.push(`${choice.label} sugar`);
    else                          bits.push(choice.label);   // temp + custom groups
  }
  if (config.notes) bits.push(`"${config.notes}"`);
  return bits.join(' · ');
}

/* ==========================================================
   THEME
   ========================================================== */
const THEME_KEY = 'bossb-theme';
const ADMIN_TAB_KEY = 'bb_admin_tab';   // last admin tab, restored on refresh
function applyTheme(t)     { document.documentElement.setAttribute('data-theme', t); }
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'dark' || saved === 'light'
    ? saved
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}
let themeAnimTimer = null;
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  // Briefly enable a global colour transition so the switch fades in
  // instead of snapping. The class is removed after the fade so normal
  // interactions stay snappy (no permanent transition on everything).
  const root = document.documentElement;
  root.classList.add('theme-anim');
  clearTimeout(themeAnimTimer);
  themeAnimTimer = setTimeout(() => root.classList.remove('theme-anim'), 450);
  applyTheme(next);
}

/* ==========================================================
   TOAST
   ========================================================== */
const toastEl = $('#toast');
let toastTimer;
function showToast(msg, variant = '') {
  // Customer-facing toast: suppress when the admin panel is
  // open in this tab. An admin actively managing orders
  // doesn't need a customer-context popup about "their" order
  // (they're the same human, just in a different role).
  if (adminPanelOpenForToasts()) return;
  toastEl.textContent = msg;
  toastEl.className   = 'toast show ' + variant;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}
function adminPanelOpenForToasts() {
  const p = document.getElementById('adminPanel');
  return !!p && !p.hidden;
}

/* ==========================================================
   CONFIG → DOM
   ========================================================== */
function applyConfigToDOM() {
  document.title = `${CONFIG.shopName} — Order`;
  const bn = $('#brandName');    if (bn) bn.textContent = CONFIG.shopName;
  const bt = $('#brandTagline'); if (bt) bt.textContent = CONFIG.tagline;
  // Keep the topbar logo labeled with the (possibly rebranded) name.
  const bl = $('#brandLogo');    if (bl) bl.alt = CONFIG.shopName || 'OrderInn';
  // Logo initials follow the shop name automatically, so a rebrand
  // from Settings updates every brand mark on the page — no more
  // hardcoded letters to hunt down.
  const initials = Store.brandInitials(CONFIG.shopName);
  document.querySelectorAll('.brand-mark').forEach(el => { el.textContent = initials; });
}

/* Deterministic colour from a name/id so every chat participant keeps a
   consistent, easy-to-spot colour (instead of everyone being brown).
   Mid lightness so it reads on both light and dark backgrounds. */
function colorForName(str) {
  str = String(str || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return `hsl(${h}, 62%, 48%)`;
}
/* First 1–2 initials for an avatar from a name. */
function initialsForName(str) {
  const parts = String(str || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
