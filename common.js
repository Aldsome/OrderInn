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
  if (item && item.img) {
    const hide = ['display:none', extra].filter(Boolean).join(';');
    return `<img src="${item.img}" alt="${escapeHtml(opts.alt || '')}" loading="${loading}" `
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
  $('#brandName').textContent    = CONFIG.shopName;
  $('#brandTagline').textContent = CONFIG.tagline;
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
