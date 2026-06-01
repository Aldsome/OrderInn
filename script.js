/* ==========================================================
   BOSSB COFFEE SHOP — APP LOGIC
   Single-file SPA with two views in the same DOM:
   - Customer ordering (default)
   - Admin panel (overlays customer view when signed in)
   ========================================================== */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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

/* ==========================================================
   STATE
   ========================================================== */
const state = {
  cart:        [],
  category:    'all',
  tableNumber: null,
  editingLineKey: null,
  pendingQty:  1,
  editingOrderId: null,   // when set, placing the cart UPDATES this order
};

let MENU   = Store.getMenu();
let CONFIG = Store.getConfig();

/* ==========================================================
   FORMAT HELPERS
   ========================================================== */
const peso = (n) => `${CONFIG.currency}${Number(n).toFixed(2)}`;
const getOpt = (list, id) => list.find(o => o.id === id);

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
function applyTheme(t)     { document.documentElement.setAttribute('data-theme', t); }
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'dark' || saved === 'light'
    ? saved
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
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
}

/* ==========================================================
   TABLE LABEL  (free-text — "Window seat", "Booth A", "5")
   ========================================================== */
function readTableFromURL() {
  const params = new URLSearchParams(location.search);
  const t = params.get('table');
  return t ? t.trim() : null;
}
function setTableLabel(label) {
  state.tableNumber = label;                 // kept as `tableNumber` for compat
  $('#tableNumberDisplay').textContent = label || '—';
  if (label) {
    Store.setSessionTable(label);
    Store.bumpActiveSession(label);
  } else {
    Store.clearSessionTable();
    Store.dropActiveSession();
  }
  // The status banner + My-orders bubble are linked to the current
  // room, so re-evaluate them whenever the room changes (e.g. the
  // banner must stop showing an order left behind in a prior room,
  // and a newly-joined table's orders must appear immediately).
  // Guarded: these run only after boot wires everything up.
  if (typeof refreshOrderStatusBanner === 'function') refreshOrderStatusBanner();
  if (typeof refreshMyOrdersFab === 'function') refreshMyOrdersFab();
}
function ensureTable() {
  // QR-code path: URL ?table= overrides everything and always
  // wins (it's how customers arrive at a specific table).
  const t = readTableFromURL();
  if (t) {
    setTableLabel(t);
    return;
  }
  // Authenticated admins skip the prompt entirely — their
  // signed-in identity *is* the table label, so any order they
  // place is tied to their staff name.
  const session = Store.getSession();
  if (session && session.role === 'admin') {
    setTableLabel(session.name || session.email);
    return;
  }
  // Recent guest session (< 24h, same device) — reuse the
  // previous label so a refresh doesn't kick the customer back
  // to the prompt. Inactivity reset is what clears this, NOT
  // page reload.
  const recent = Store.getSessionTable();
  if (recent && recent.name) {
    // If a different live session has stolen the name in the
    // meantime, treat it as expired and reprompt with prefill.
    if (Store.findActiveSessionByName(recent.name)) {
      openTableModalPrefilled(recent.name);
      return;
    }
    setTableLabel(recent.name);
    return;
  }
  openTableModal();
}
function openTableModalPrefilled(name) {
  $('#tableInput').value = name || '';
  openTableModal();
}
function openTableModal()  {
  const jp = $('#joinPinInput'); if (jp) jp.value = '';
  const je = $('#joinPinError'); if (je) je.hidden = true;
  openModal('#tableModal');
}
function closeTableModal() { closeModal('#tableModal'); }

/* Join-by-PIN: a tablemate enters the table's 4-digit PIN and is
   dropped straight into that room — no name typed, no collision
   check (the PIN is the authorization). The fast path that avoids
   the conflicting-name problem entirely. */
function joinByPin() {
  const inp = $('#joinPinInput');
  const err = $('#joinPinError');
  const pin = (inp?.value || '').trim();
  if (err) err.hidden = true;
  if (!/^\d{3,4}$/.test(pin)) {
    if (err) { err.textContent = 'Enter the 3–4 digit PIN from your tablemate.'; err.hidden = false; }
    return;
  }
  const found = Store.findTableByPin(pin);
  if (!found || !found.label) {
    if (err) { err.textContent = 'No active table has that PIN. Double-check with your tablemate.'; err.hidden = false; }
    return;
  }
  // Adopt the matched room as our table/identity. Bypass the
  // name-collision flow on purpose — joining is authorised by the PIN.
  setTableLabel(found.label);
  closeTableModal();
  bumpInactivity();
  refreshOrderStatusBanner();
  refreshMyOrdersFab();
  showToast(`Joined "${found.label}" ☕`, 'success');
}
$('#joinPinBtn').addEventListener('click', joinByPin);
$('#joinPinInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); joinByPin(); }
});

/* Two layers of collision check before accepting a table label:
   1. A *live* session on another device holding the same name —
      this blocks BEFORE either device has even ordered. The
      second person is told to pick a different label; no
      "join this table" prompt because the issue is name reuse,
      not legitimate table sharing.
   2. Otherwise, an in-flight ORDER under this label on another
      device — this is the legitimate "joining this table?" case
      (one person paid, friends are adding more rounds). */
async function checkDuplicateTable(label, onAccept) {
  // Layer 0 — the customer re-entered the name/number they are
  // ALREADY in. Nothing to join or validate: just acknowledge
  // "you're already in this room" and let Continue drop them back
  // on the page. Short-circuits before any collision/PIN logic.
  if (state.tableNumber &&
      String(label).trim().toLowerCase() === String(state.tableNumber).trim().toLowerCase()) {
    showDupModal({ mode: 'sameRoom', label, onAccept });
    return;
  }
  // Layer 1 — any active order at this label, from any device
  // (including this one). Orders sync through Supabase, so this
  // works cross-device. An existing order is the LEGITIMATE
  // group-room / table-sharing case and takes precedence over the
  // name-collision block below: a friend joining a table that
  // already has an order must always get the join/PIN flow, never
  // the hard "name is taken" wall (the table owner's open page is
  // itself holding a live session for this name, which would
  // otherwise trip Layer 2 and make joining impossible).
  const matches = Store.findActiveOrdersByTable(label);
  if (matches.length > 0) {
    const myIds = Store.getMyClientIds();
    // "Member" = this device already has an active order at this
    // label (the table owner, or someone who joined earlier on
    // this device). We match against this browser's CURRENT *and
    // past* client ids so a soft reset (visit-end, inactivity,
    // staff login/out) doesn't lock the same device out of its own
    // table. Members continue freely. Everyone else is a would-be
    // joiner and must pass the table PIN — including a cache-cleared
    // returnee, who reclaims via that PIN gate.
    const isMember = matches.some(o => myIds.includes(o.clientId));
    if (isMember) {
      showDupModal({ mode: 'ownOrder', label, count: matches.length, onAccept });
    } else {
      // The table's join PIN lives on its active orders (minted by
      // the first order). null = legacy orders placed before the
      // PIN feature existed → no gate (graceful degradation).
      const pin = matches.map(o => o.joinPin).find(Boolean) || null;
      showDupModal({ mode: 'share', label, count: matches.length, onAccept, pin });
    }
    return;
  }

  // Layer 2 — no order at this label yet, but another live device
  // is already holding this exact name. First the LOCAL registry
  // (another tab of the same browser), then the REMOTE registry
  // via Supabase (another DEVICE holding the same name before
  // either has ordered — e.g. PC "art" + phone "art"). Hard block:
  // there's nothing to join yet, so two strangers shouldn't both
  // sit as the same name (staff would mix up orders). The second
  // person picks a different label.
  let conflictId = Store.findActiveSessionByName(label);
  if (!conflictId) conflictId = await Store.findActiveSessionByNameRemote(label);
  // A "conflict" against one of THIS browser's own past client ids is
  // just our own stale session after a soft reset — not a real clash.
  // Accept straight through (setTableLabel re-bumps the session under
  // the current id).
  if (conflictId && Store.getMyClientIds().includes(conflictId)) conflictId = null;
  if (conflictId) {
    // Another live device holds this exact name and there's no order
    // to join. Default action is still "choose another name", but we
    // offer a reclaim escape hatch ("It's me — use this name") for the
    // returning customer who e.g. cleared their browser — see BUG2.
    showDupModal({ mode: 'nameTaken', label, onAccept });
    return;
  }

  onAccept();
}
let pendingTableLabel  = null;
let pendingTableAccept = null;
let pendingTablePin    = null;   // expected PIN for the share-join gate
let pinAttempts        = 0;

/* Configure + open the duplicate/collision modal. Four modes:
   - 'sameRoom'  : the customer re-entered the name they're already
                   in — single Continue button returns to the page.
   - 'nameTaken' : another live device holds this exact name —
                   only option is to choose a different label.
   - 'ownOrder'  : this device already has an open order here —
                   offer continue (join) or sit elsewhere.
   - 'share'     : someone else has an open order at this label —
                   offer join (table sharing) or sit elsewhere. */
function showDupModal({ mode, label, count = 1, onAccept = null, pin = null }) {
  const modal   = $('#dupTableModal');
  const desc    = $('#dupTableDesc');
  const title   = $('#dupTableTitle');
  const labelEl = $('#dupTableLabel');
  const joinBtn = $('#dupTableJoinBtn');
  const elseBtn = $('#dupTableElsewhereBtn');
  const pinRow  = $('#dupPinRow');
  const pinErr  = $('#dupPinError');
  const pinInp  = $('#dupPinInput');

  if (!modal || !joinBtn || !elseBtn) {
    console.error('[Store] duplicate-table modal markup is missing. Expected #dupTableModal, #dupTableJoinBtn, and #dupTableElsewhereBtn.');
    pendingTableLabel = null;
    pendingTableAccept = null;
    pendingTablePin = null;
    pinAttempts = 0;
    openTableModal();
    return;
  }

  if (labelEl) labelEl.textContent = label;
  // Reset PIN UI + button visibility each time (modes below only
  // override what they need to change).
  pendingTablePin = null;
  pinAttempts = 0;
  if (pinRow) pinRow.hidden = true;
  if (pinErr) pinErr.hidden = true;
  if (pinInp) pinInp.value = '';
  joinBtn.hidden = false;
  joinBtn.disabled = false;
  elseBtn.hidden = false;

  if (mode === 'sameRoom') {
    if (title) title.textContent = "You're already here";
    joinBtn.textContent = 'Continue';
    elseBtn.hidden = true;                        // only one action: go back
    if (desc) desc.textContent =
      `You're already in "${label}" — this is your current table and order list.`;
    pendingTableAccept = onAccept;
  } else if (mode === 'nameTaken') {
    if (title) title.textContent = 'That name is taken';
    if (desc) desc.textContent =
      `The name "${label}" looks like it's in use on another device. If that's not you, pick a different name so staff don't mix up your orders. If you're the same person returning (for example you cleared your browser), you can take it back.`;
    // Default, safe action stays "choose another name". The reclaim
    // button is the escape hatch for a returning customer (BUG2): no
    // active order exists at this label, so there's nothing to mix up
    // by letting them retake the name.
    elseBtn.textContent = 'Choose another name';
    joinBtn.hidden = false;
    joinBtn.textContent = "It's me — use this name";
    pendingTableAccept = onAccept;               // reclaim accepts the label
  } else if (mode === 'ownOrder') {
    if (title) title.textContent = 'Already an open order here';
    joinBtn.hidden = false;
    joinBtn.textContent = 'Continue with it';
    elseBtn.textContent = "I'm somewhere else";
    if (desc) desc.textContent =
      `You already have ${count === 1 ? 'an' : count} open order here. Continue with it, or sit somewhere else?`;
    pendingTableAccept = onAccept;
  } else {   // 'share' — a would-be joiner; gate behind the table PIN
    if (title) title.textContent = 'Join this table?';
    joinBtn.hidden = false;
    joinBtn.textContent = 'Join this table';
    elseBtn.textContent = "I'm somewhere else";
    if (desc) desc.textContent =
      `"${label}" already has an open order. To add to this table, enter the table's PIN — ask the person who started it.`;
    pendingTableAccept = onAccept;
    // Only show the PIN gate when the table actually has a PIN.
    if (pin) {
      pendingTablePin = pin;
      if (pinRow) pinRow.hidden = false;
    }
  }
  pendingTableLabel = label;
  closeTableModal();            // ensure the dup prompt isn't painted behind the table modal
  openModal('#dupTableModal');
  if (mode === 'share' && pin && pinInp) setTimeout(() => pinInp.focus(), 50);
}

$('#dupTableJoinBtn').addEventListener('click', () => {
  // Share-join gate: if a PIN is expected, validate it first.
  if (pendingTablePin) {
    const pinInput = $('#dupPinInput');
    const entered = (pinInput?.value || '').trim();
    if (entered !== pendingTablePin) {
      pinAttempts++;
      const err = $('#dupPinError');
      if (err) {
        err.textContent = pinAttempts >= 5
          ? 'Too many attempts. Please ask staff for help.'
          : 'Incorrect PIN. Ask the person who started this table.';
        err.hidden = false;
      }
      if (pinInput) {
        pinInput.focus();
        pinInput.select();
      }
      if (pinAttempts >= 5) $('#dupTableJoinBtn').disabled = true;
      return;
    }
  }
  const accept = pendingTableAccept;
  closeModal('#dupTableModal');
  pendingTableLabel = null; pendingTableAccept = null; pendingTablePin = null; pinAttempts = 0;
  $('#dupTableJoinBtn').disabled = false;
  if (accept) accept();
});
$('#dupTableElsewhereBtn').addEventListener('click', () => {
  closeModal('#dupTableModal');
  pendingTableLabel = null; pendingTableAccept = null; pendingTablePin = null; pinAttempts = 0;
  $('#dupTableJoinBtn').disabled = false;
  $('#tableInput').value = '';
  openTableModal();
});

$('#tableForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#tableInput');
  const label = input.value.trim();
  if (!label) {
    // Reinforce HTML5 required — input.required already blocks
    // submit but show a friendlier hint in case styling hid it.
    input.setCustomValidity('Please enter a table name or number.');
    input.reportValidity();
    input.setCustomValidity('');
    return;
  }
  // Brief disable while the (async) remote collision check runs.
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    await checkDuplicateTable(label, () => {
      moveOrdersOnTableChange(label);   // carry / cancel active orders when moving
      setTableLabel(label);
      closeTableModal();
      bumpInactivity();
    });
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

/* When a guest changes to a DIFFERENT label while they have active
   orders at the old one, offer to move those orders along (they
   follow the person). Declining cancels them — the customer is
   leaving that room. No-op when there's nothing active to move. */
function moveOrdersOnTableChange(newLabel) {
  const oldLabel = state.tableNumber;
  if (!oldLabel || sameLabel(oldLabel, newLabel)) return;
  const mine = Store.getMyOrders().filter(o =>
    (o.status === 'pending' || o.status === 'preparing') && sameLabel(o.tableNumber, oldLabel));
  if (!mine.length) return;
  const move = confirm(
    `You have ${mine.length} active order${mine.length === 1 ? '' : 's'} at "${oldLabel}".\n\n` +
    `OK = move ${mine.length === 1 ? 'it' : 'them'} to "${newLabel}".\n` +
    `Cancel = cancel ${mine.length === 1 ? 'that order' : 'those orders'}.`
  );
  if (move) {
    Store.moveOrders(mine.map(o => o.id), newLabel);
    showToast(`Moved ${mine.length} order${mine.length === 1 ? '' : 's'} to "${newLabel}"`, 'success');
  } else {
    mine.forEach(o => Store.updateOrderStatus(o.id, 'cancelled'));
    showToast(`Cancelled ${mine.length} order${mine.length === 1 ? '' : 's'}`, 'info');
  }
  refreshAdminActivity();
}
$('#changeTableBtn').addEventListener('click', () => {
  // When an account is logged in (admin or, in future, a
  // customer account) this button is "Log out" rather than
  // "change" — the table label is the account identity, not a
  // freely-editable guest name. adminSignOut() clears the
  // session, drops the auto-stamped label, and re-prompts as a
  // guest. For guests, keep the original change-table behavior.
  if (Store.getSession()) {
    adminSignOut();
    return;
  }
  $('#tableInput').value = state.tableNumber || '';
  openTableModal();
});

/* Keep the active-session registry's lastActive for THIS device
   fresh while the customer is interacting. Lets other devices
   reliably tell when a name is "abandoned" and free to reuse. */
setInterval(() => {
  if (state.tableNumber) Store.bumpActiveSession(state.tableNumber);
}, 60 * 1000);

/* ==========================================================
   MENU RENDERING
   ========================================================== */
const menuGrid = $('#menuGrid');
function renderMenu() {
  const items = state.category === 'all'
    ? MENU
    : MENU.filter(m => m.category === state.category);

  if (items.length === 0) {
    menuGrid.innerHTML = `<p class="empty-state" style="grid-column:1/-1">No items in this category.</p>`;
    return;
  }

  menuGrid.innerHTML = items.map(item => `
    <article class="product-card" data-id="${item.id}">
      <div class="placeholder-img" aria-hidden="true">
        <img src="${item.img || ''}" alt="${escapeHtml(item.name)}" loading="lazy"
             onerror="this.style.display='none'">
        <span class="ph-fallback">${item.emoji || '☕'}</span>
      </div>
      <div class="product-body">
        ${item.tag ? `<span class="tag">${escapeHtml(item.tag)}</span>` : ''}
        <h3>${escapeHtml(item.name)}</h3>
        <p class="desc">${escapeHtml(item.desc || '')}</p>
        <div class="row-bottom">
          <span class="price">${peso(item.price)}</span>
        </div>
      </div>
    </article>
  `).join('');
  updateInCartBadges();
}

function updateInCartBadges() {
  document.querySelectorAll('.product-card').forEach(card => {
    const id  = card.dataset.id;
    const qty = state.cart.filter(l => l.id === id).reduce((s, l) => s + l.qty, 0);
    card.classList.toggle('in-cart', qty > 0);
    let bubble = card.querySelector('.cart-count-bubble');
    if (qty > 1) {
      if (!bubble) {
        bubble = document.createElement('span');
        bubble.className = 'cart-count-bubble';
        card.appendChild(bubble);
      }
      bubble.textContent = qty;
    } else if (bubble) {
      bubble.remove();
    }
  });
}

/* Customer category chips — rendered from the data-driven category
   list so any category an admin adds shows up here too. "All" is
   always first. Uses event delegation on the container so it keeps
   working across re-renders (e.g. after a category is added). */
function renderCategoryChips() {
  const nav = $('#categoryChips');
  if (!nav) return;
  const cats = Store.getCategories();
  // Drop a stale selection if its category was removed.
  if (state.category !== 'all' && !cats.some(c => c.id === state.category)) {
    state.category = 'all';
  }
  const chip = (id, label) =>
    `<button class="chip${state.category === id ? ' active' : ''}" data-category="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
  nav.innerHTML = chip('all', 'All') + cats.map(c => chip(c.id, c.label)).join('');
}
$('#categoryChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $$('.chip', $('#categoryChips')).forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  state.category = chip.dataset.category;
  renderMenu();
});

menuGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.product-card');
  if (!card) return;
  openCustomizer(card.dataset.id);
});

/* ==========================================================
   CART
   ========================================================== */
const cartDrawer = $('#cartDrawer');
const cartItemsEl = $('#cartItems');
const cartTotalEl = $('#cartTotal');

function findLine(key) { return state.cart.find(l => l.lineKey === key); }
function cartTotals() {
  let subtotal = 0, count = 0;
  for (const line of state.cart) {
    const item = MENU.find(m => m.id === line.id);
    if (!item) continue;
    subtotal += unitPrice(item, line.config) * line.qty;
    count += line.qty;
  }
  return { subtotal, count };
}
function addLine(itemId, config, qty = 1) {
  const lineKey = lineKeyOf(itemId, config);
  const existing = findLine(lineKey);
  if (existing) existing.qty += qty;
  else state.cart.push({ id: itemId, lineKey, qty, config });
  updateCart();
}
function updateLine(oldKey, itemId, config, qty) {
  const idx = state.cart.findIndex(l => l.lineKey === oldKey);
  if (idx === -1) return;
  const newKey = lineKeyOf(itemId, config);
  if (newKey !== oldKey) {
    const collide = state.cart.find(l => l.lineKey === newKey);
    if (collide) {
      collide.qty += qty;
      state.cart.splice(idx, 1);
    } else {
      state.cart[idx] = { id: itemId, lineKey: newKey, qty, config };
    }
  } else {
    state.cart[idx].qty = qty;
    state.cart[idx].config = config;
  }
  updateCart();
}
function changeQty(key, delta) {
  const line = findLine(key);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) state.cart = state.cart.filter(l => l.lineKey !== key);
  updateCart();
}
function removeLine(key) {
  state.cart = state.cart.filter(l => l.lineKey !== key);
  updateCart();
}
function clearCart() {
  state.cart = [];
  updateCart();
}

function updateCart() {
  const { subtotal, count } = cartTotals();

  // FAB
  $('#fabCartCount').textContent = count;
  $('#fabCartTotal').textContent = peso(subtotal);
  $('#fabCartBtn').classList.toggle('hidden-empty', count === 0);

  // Drawer
  if (state.cart.length === 0) {
    cartItemsEl.innerHTML = `<p class="empty-state">Your cart is empty. Tap any item to add ☕</p>`;
  } else {
    cartItemsEl.innerHTML = state.cart.map(line => {
      const item = MENU.find(m => m.id === line.id);
      if (!item) return '';
      const u = unitPrice(item, line.config);
      const summary = configSummary(item, line.config);
      return `
        <div class="cart-item" data-key="${line.lineKey}">
          <div class="thumb">
            <img src="${item.img || ''}" alt="" loading="lazy" onerror="this.style.display='none'">
            <span>${item.emoji || '☕'}</span>
          </div>
          <div>
            <div class="title">${escapeHtml(item.name)}</div>
            ${summary ? `<div class="cz-summary">${escapeHtml(summary)}</div>` : ''}
            <div class="qty-row">
              <button data-dec="${line.lineKey}" aria-label="Less">−</button>
              <span>${line.qty}</span>
              <button data-inc="${line.lineKey}" aria-label="More">+</button>
              <button class="edit" data-edit="${line.lineKey}">Edit</button>
              <button class="remove" data-rem="${line.lineKey}">Remove</button>
            </div>
          </div>
          <div class="item-price">${peso(u * line.qty)}</div>
        </div>
      `;
    }).join('');
  }

  cartTotalEl.textContent = peso(subtotal);
  $('#placeOrderBtn').disabled = count === 0;

  updateInCartBadges();
}

cartItemsEl.addEventListener('click', (e) => {
  const inc = e.target.dataset.inc;
  const dec = e.target.dataset.dec;
  const rem = e.target.dataset.rem;
  const edt = e.target.dataset.edit;
  if (inc) changeQty(inc, +1);
  if (dec) changeQty(dec, -1);
  if (rem) removeLine(rem);
  if (edt) {
    const line = findLine(edt);
    if (line) openCustomizer(line.id, { editLineKey: edt });
  }
});

function openCart()  {
  cartDrawer.classList.add('open');
  cartDrawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('cart-open');   // hides the FAB via CSS
  // Opening the cart steals focus from the my-orders sheet —
  // close it so we don't have two overlapping surfaces.
  if (!$('#myOrdersSheet').hidden) closeMyOrders();
}
function closeCart() {
  cartDrawer.classList.remove('open');
  cartDrawer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('cart-open');
}
$('#fabCartBtn').addEventListener('click', openCart);
$('#closeCartBtn').addEventListener('click', closeCart);

/* Click outside the drawer to close it — but ONLY when the
   click lands on truly empty page area. Clicking a product
   card (to add another item), a category chip, a modal, or
   any cart-related control keeps the drawer open.
   The my-orders sheet uses the same rules below. */
document.addEventListener('click', (e) => {
  const t = e.target;
  const myOrdersOpen = !$('#myOrdersSheet').hidden;
  const cartOpen     = cartDrawer.classList.contains('open');

  if (cartOpen) {
    let close = true;
    if (cartDrawer.contains(t))                                            close = false;
    else if (t.closest('.product-card'))                                   close = false;
    else if (t.closest('.chip'))                                           close = false;
    else if (t.closest('.fab-cart'))                                       close = false;
    else if (t.closest('.modal, .myorders-sheet'))                         close = false;
    else if (t.closest('.topbar-actions, .table-strip, .order-status-banner')) close = false;
    if (close) closeCart();
  }

  if (myOrdersOpen) {
    let close = true;
    if ($('#myOrdersSheet').contains(t))                                   close = false;
    else if (t.closest('.fab-myorders'))                                   close = false;
    else if (t.closest('.modal, .cart-drawer'))                            close = false;
    else if (t.closest('.topbar-actions, .order-status-banner'))           close = false;
    // Clicking the View Cart FAB or a product card SHOULD close
    // the my-orders sheet — the customer's attention is moving
    // to a different surface.
    if (close) closeMyOrders();
  }
});

/* Shake animation — called whenever an item is added to the
   cart. The cart FAB pulses to draw the eye toward where the
   item went; the source product card briefly rocks so the
   customer can see "yes, this one." */
function bumpShake(itemId) {
  const fab = $('#fabCartBtn');
  if (fab) {
    fab.classList.remove('shake');
    void fab.offsetWidth;                     // restart the animation
    fab.classList.add('shake');
    setTimeout(() => fab.classList.remove('shake'), 600);
  }
  const card = document.querySelector(`.product-card[data-id="${itemId}"]`);
  if (card) {
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
    setTimeout(() => card.classList.remove('shake'), 600);
  }
}

/* ==========================================================
   CUSTOMIZER MODAL
   ========================================================== */
const customizerModal = $('#customizerModal');
function buildOpts(container, list, currentId, onPick) {
  container.innerHTML = list.map(o => `
    <button type="button" class="cz-opt ${o.id === currentId ? 'active' : ''}" data-id="${o.id}">
      <span>${escapeHtml(o.label)}</span>
      ${o.delta ? `<span class="cz-opt-delta">${o.delta > 0 ? '+' : '-'}${peso(Math.abs(o.delta)).replace(CONFIG.currency, CONFIG.currency)}</span>` : ''}
    </button>
  `).join('');
  container.querySelectorAll('.cz-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.cz-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onPick(btn.dataset.id);
    });
  });
}

function openCustomizer(itemId, opts = {}) {
  // Hard gate: no customizing / adding without a table label.
  // Send the customer back to the table prompt — they can't
  // build a cart while the table is empty.
  if (!state.tableNumber) {
    showToast('Please enter your table first', 'error');
    openTableModal();
    return;
  }
  const item = MENU.find(m => m.id === itemId);
  if (!item) return;
  const o = item.options || {};
  const canCustomize = optionDefs().some(def => o[def.key]);

  if (!canCustomize && !opts.editLineKey) {
    addLine(item.id, defaultConfigFor(item), 1);
    showToast(`${item.name} added`, 'success');
    bumpShake(item.id);
    return;
  }

  let config = opts.editLineKey
    ? JSON.parse(JSON.stringify(findLine(opts.editLineKey).config))
    : defaultConfigFor(item);
  let qty = opts.editLineKey ? findLine(opts.editLineKey).qty : 1;
  state.editingLineKey = opts.editLineKey || null;
  state.pendingQty = qty;

  $('#czCategory').textContent  = item.category.charAt(0).toUpperCase() + item.category.slice(1);
  $('#czName').textContent      = item.name;
  $('#czDesc').textContent      = item.desc;
  $('#czBasePrice').textContent = `Base ${peso(item.price)}`;
  $('#czImage').innerHTML = `
    <img src="${item.img || ''}" alt="" loading="eager" onerror="this.style.display='none'">
    <span class="ph-fallback" style="font-size:2rem">${item.emoji || '☕'}</span>
  `;
  $('#czAddLabel').textContent = opts.editLineKey ? 'Save changes' : 'Add to cart';
  $('#czTitle').textContent    = opts.editLineKey ? 'Edit item'    : 'Customize';

  $('#czSizeSection').hidden  = !o.size;
  $('#czTempSection').hidden  = !o.temp;
  $('#czMilkSection').hidden  = !o.milk;
  $('#czSugarSection').hidden = !o.sugar;

  if (o.size)  buildOpts($('#czSizeOptions'),  SIZES,  config.size,  v => { config.size  = v; refresh(); });
  if (o.temp)  buildOpts($('#czTempOptions'),  TEMPS,  config.temp,  v => { config.temp  = v; refresh(); });
  if (o.milk)  buildOpts($('#czMilkOptions'),  MILKS,  config.milk,  v => { config.milk  = v; refresh(); });
  if (o.sugar) buildOpts($('#czSugarOptions'), SUGAR,  config.sugar, v => { config.sugar = v; refresh(); });

  // Custom (admin-defined) option groups — one section each, same
  // button-list UI as the built-ins.
  const customHost = $('#czCustomSections');
  customHost.innerHTML = '';
  for (const g of Store.getOptionGroups()) {
    if (!o[g.id] || !(g.choices || []).length) continue;
    const sec = document.createElement('section');
    sec.className = 'cz-section';
    sec.innerHTML = `<h5>${escapeHtml(g.label)}</h5><div class="cz-options"></div>`;
    customHost.appendChild(sec);
    buildOpts(sec.querySelector('.cz-options'), g.choices, config[g.id],
      v => { config[g.id] = v; refresh(); });
  }

  $('#czNotes').value = config.notes || '';
  $('#czNotes').oninput = (e) => { config.notes = e.target.value; };

  $('#czQty').textContent = state.pendingQty;
  $('#czQtyDec').onclick = () => { if (state.pendingQty > 1) { state.pendingQty--; $('#czQty').textContent = state.pendingQty; refresh(); } };
  $('#czQtyInc').onclick = () => { state.pendingQty++; $('#czQty').textContent = state.pendingQty; refresh(); };

  function refresh() {
    const u = unitPrice(item, config);
    $('#czTotal').textContent = peso(u * state.pendingQty);
  }
  refresh();

  $('#customizerForm').onsubmit = (e) => {
    e.preventDefault();
    if (state.editingLineKey) {
      updateLine(state.editingLineKey, item.id, config, state.pendingQty);
      showToast(`${item.name} updated`);
    } else {
      addLine(item.id, config, state.pendingQty);
      showToast(`${item.name} added`, 'success');
      bumpShake(item.id);
    }
    closeCustomizer();
  };

  openModal('#customizerModal');
}
function closeCustomizer() {
  closeModal('#customizerModal');
  state.editingLineKey = null;
}
$('#closeCustomizerBtn').addEventListener('click', closeCustomizer);

/* ==========================================================
   PLACE ORDER
   ========================================================== */
$('#placeOrderBtn').addEventListener('click', async () => {
  if (state.cart.length === 0) return;
  if (!state.tableNumber) {
    openTableModal();
    return;
  }
  const btn = $('#placeOrderBtn');
  if (btn.dataset.placing === '1') return;   // guard against double-tap
  btn.dataset.placing = '1';
  btn.disabled = true;
  const items = state.cart.map(line => {
    const item = MENU.find(m => m.id === line.id);
    return {
      itemId:    item.id,
      name:      item.name,
      qty:       line.qty,
      unitPrice: unitPrice(item, line.config),
      config:    line.config,
      summary:   configSummary(item, line.config),
    };
  });

  // MODIFY MODE — update an existing (still-pending) order instead of
  // placing a new one. Shares the cart UI; the button label reflects it.
  if (state.editingOrderId) {
    const editId = state.editingOrderId;
    const result = Store.updateOrderItems(editId, items, state.tableNumber ? undefined : undefined);
    btn.dataset.placing = '0';
    btn.disabled = false;
    if (!result.ok) {
      showToast(result.reason === 'already_started'
        ? 'Too late to modify — it\'s being prepared.'
        : 'Could not modify the order.', 'error');
      finishEditingOrder();
      renderMyOrdersList();
      refreshOrderStatusBanner();
      return;
    }
    showToast(`Order #${result.order.number} updated`, 'success');
    finishEditingOrder();
    clearCart();
    closeCart();
    ORDER_STATUS_BY_ID.set(editId, result.order.status);
    refreshOrderStatusBanner();
    refreshMyOrdersFab();
    renderMyOrdersList();
    refreshAdminActivity();
    if (!adminPanel.hidden && $('.admin-tab.active').dataset.adminTab === 'orders') renderOrders();
    return;
  }

  let order;
  try {
    // placeOrder is async in remote mode (it queries Supabase
    // for the authoritative max order number to avoid collisions).
    order = await Store.placeOrder({
      tableNumber: state.tableNumber,
      items,
    });
  } catch (e) {
    showToast('Could not place order — please try again', 'error');
    btn.dataset.placing = '0';
    btn.disabled = false;
    return;
  }
  btn.dataset.placing = '0';
  clearCart();
  closeCart();

  // Remember this customer's active order so the status banner
  // and the modal can poll for live updates from the admin.
  setActiveOrder(order.id);
  openOrderPlacedModal(order);
  refreshOrdersBadge();
  refreshMyOrdersFab();
  // A new order resets the "show thanks" lockout so a second
  // visit will retrigger it after all orders are served.
  thanksShown = false;
  refreshAdminActivity();
  // Realtime: refresh the admin panel if it happens to be open
  // in this same tab, and seed the new order into the local
  // baseline so the cross-tab "new order!" toast doesn't
  // double-fire when the storage event echoes the same write.
  knownOrderIds.add(order.id);
  ORDER_STATUS_BY_ID.set(order.id, order.status);
  if (!adminPanel.hidden && $('.admin-tab.active').dataset.adminTab === 'orders') {
    renderOrders();
  }
});

/* Customer "Modify" — pull a still-pending order's items back into
   the cart and switch the cart into update mode. Shares the same
   grace window as Cancel (only offered while cancellable). */
function startEditingOrder(order) {
  clearCart();
  state.editingOrderId = order.id;
  for (const it of order.items) {
    addLine(it.itemId, JSON.parse(JSON.stringify(it.config || {})), it.qty);
  }
  $('#placeOrderBtn').textContent = `Update order #${order.number}`;
  closeMyOrders();
  openCart();
  showToast('Editing your order — change items, then tap Update', 'success');
}
function finishEditingOrder() {
  state.editingOrderId = null;
  $('#placeOrderBtn').textContent = 'Place Order';
}

$('#newOrderBtn').addEventListener('click', () => {
  closeModal('#orderPlacedModal');
  // "Start new order" = the customer is done with the last
  // order; clear it so the banner goes away.
  clearActiveOrder();
});
$('#closePlacedBtn').addEventListener('click', () => closeModal('#orderPlacedModal'));
$('#placedPinCopyBtn').addEventListener('click', async () => {
  await copyTextToClipboard($('#placedPinCopyBtn').dataset.pin || '');
  showToast('Table PIN copied — keep it handy', 'success');
});

/* ==========================================================
   CUSTOMER ORDER STATUS BANNER
   - Polls every 5s when an active order exists.
   - Banner click → re-opens the order-placed modal with the
     latest status reflected.
   ========================================================== */
const STATUS_INFO = {
  pending:   { icon: '⏳', text: 'Sent to the kitchen',  modalTitle: 'Order placed!',     modalSubtitle: 'Show this number to your server.' },
  preparing: { icon: '☕', text: 'Your order is being prepared', modalTitle: 'Being prepared', modalSubtitle: 'Our barista is on it. Hang tight.' },
  served:    { icon: '✓',  text: 'Ready / served',     modalTitle: 'Enjoy!',           modalSubtitle: 'Your order has been served. Don\'t forget to pay at the counter.' },
  cancelled: { icon: '✕',  text: 'Order cancelled',    modalTitle: 'Order cancelled',  modalSubtitle: 'Please ask staff if this was a mistake.' },
};

let statusPollTimer = null;

function setActiveOrder(orderId) {
  localStorage.setItem('bossb_active_order', orderId);
  refreshOrderStatusBanner();
  if (statusPollTimer) clearInterval(statusPollTimer);
  statusPollTimer = setInterval(refreshOrderStatusBanner, 5000);
}
function clearActiveOrder() {
  localStorage.removeItem('bossb_active_order');
  $('#orderStatusBanner').hidden = true;
  if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
}
/* Case-insensitive table-label compare (labels are free text). */
function sameLabel(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function getActiveOrder() {
  const here = state.tableNumber;
  // Prefer the explicitly-stored last-placed order — but ONLY while it
  // still belongs to the CURRENT room. Otherwise the banner would
  // cling to an order left behind after the customer changed table.
  const id = localStorage.getItem('bossb_active_order');
  if (id) {
    const stored = Store.getOrders().find(o => o.id === id);
    if (stored && (!here || sameLabel(stored.tableNumber, here))) return stored;
  }
  // Otherwise track the CURRENT room: its most recent active order
  // from ANY device, so a customer who just joined an existing table
  // (and hasn't ordered yet) still sees the table's order + banner.
  // Falls back to this device's own active orders when no table label
  // is set. Keeps the banner + My orders linked to the same room.
  if (here) {
    const tableActive = Store.getTableOrders(here)
      .filter(o => o.status === 'pending' || o.status === 'preparing');
    return tableActive[0] || null;     // getTableOrders is newest-first
  }
  const fallback = getMyActiveOrders();
  return fallback[0] || null;
}

function refreshOrderStatusBanner() {
  const order = getActiveOrder();
  const banner = $('#orderStatusBanner');

  // Whatever we do with the banner, the FAB count + thank-you
  // logic always need a tick. Also surface any status changes
  // since the last tick (same-tab admin updates, cross-tab
  // sync, or cross-device polling — they all funnel here).
  refreshMyOrdersFab();
  maybeShowThanks();
  reactToCustomerOrderChanges();

  if (!order) {
    banner.hidden = true;
    return;
  }
  const info = STATUS_INFO[order.status] || STATUS_INFO.pending;
  banner.hidden = false;
  $('#orderStatusBtn').dataset.status = order.status;
  $('#bannerOrderNumber').textContent = order.number;
  $('#bannerStatusText').textContent  = info.text;
  $('#bannerStatusIcon').textContent  = info.icon;

  // If the placed modal is currently visible, sync its status too.
  if ($('#orderPlacedModal').classList.contains('open')) {
    updatePlacedModalForOrder(order);
  }
}

function openOrderPlacedModal(order) {
  updatePlacedModalForOrder(order);
  openModal('#orderPlacedModal');
}

function updatePlacedModalForOrder(order) {
  const info = STATUS_INFO[order.status] || STATUS_INFO.pending;
  $('#placedOrderNumber').textContent = order.number;
  $('#placedTable').textContent       = `Table ${order.tableNumber ?? '—'}`;
  $('#placedTitle').textContent       = info.modalTitle;
  $('#placedSubtitle').textContent    = info.modalSubtitle;
  $('#placedTickIcon').textContent    = info.icon;
  // Drive the status animation (pending pulse / preparing yin-yang
  // glow / served pop) off the card's data-status.
  const card = $('#placedTickIcon').closest('.placed-card');
  if (card) card.dataset.status = order.status;
  const pill = $('#placedStatusPill');
  pill.textContent = order.status;
  pill.className   = 'status-pill status-' + order.status;
  // Table PIN + reminder — only meaningful while the table is live.
  const pinRow = $('#placedPinRow');
  if (pinRow) {
    if (order.joinPin && order.status !== 'cancelled') {
      $('#placedPin').textContent = order.joinPin;
      $('#placedPinCopyBtn').dataset.pin = order.joinPin;
      pinRow.hidden = false;
    } else {
      pinRow.hidden = true;
    }
  }
  $('#newOrderBtn').textContent = (order.status === 'served' || order.status === 'cancelled')
    ? 'Start new order'
    : 'Place another order';

  // Track the order on the cancel button so the click handler
  // knows which one to act on.
  $('#placedCancelBtn').dataset.orderId = order.id;
  refreshPlacedCancelBtn(order);
}

/* Toggle and label the customer's self-cancel button. Visible
   only while the order is still pending AND within the grace
   window. The countdown ticks down via a 1s interval that runs
   only while the modal is open with a pending order. */
let placedCancelTicker = null;
function refreshPlacedCancelBtn(order) {
  const btn = $('#placedCancelBtn');
  if (!order || !Store.isCancellableByCustomer(order)) {
    btn.hidden = true;
    if (placedCancelTicker) { clearInterval(placedCancelTicker); placedCancelTicker = null; }
    return;
  }
  const tick = () => {
    const fresh = Store.getOrders().find(o => o.id === order.id);
    if (!fresh || !Store.isCancellableByCustomer(fresh)) {
      btn.hidden = true;
      if (placedCancelTicker) { clearInterval(placedCancelTicker); placedCancelTicker = null; }
      return;
    }
    const secs = Math.ceil(Store.cancelWindowRemaining(fresh) / 1000);
    $('#placedCancelCountdown').textContent = secs + 's';
  };
  btn.hidden = false;
  tick();
  if (placedCancelTicker) clearInterval(placedCancelTicker);
  placedCancelTicker = setInterval(tick, 1000);
}

$('#placedCancelBtn').addEventListener('click', () => {
  const orderId = $('#placedCancelBtn').dataset.orderId;
  if (!orderId) return;
  if (!confirm('Cancel this order? You can re-order any time.')) return;
  const result = Store.customerCancelOrder(orderId);
  if (!result.ok) {
    if (result.reason === 'already_started') {
      showToast('Already being prepared — please ask staff.', 'error');
    } else if (result.reason === 'window_expired') {
      showToast('Cancel window expired — please ask staff.', 'error');
    } else {
      showToast('Could not cancel.', 'error');
    }
    refreshOrderStatusBanner();
    renderMyOrdersList();
    return;
  }
  showToast('Order cancelled', 'success');
  refreshOrderStatusBanner();
  renderMyOrdersList();
  refreshMyOrdersFab();
  // Refresh the modal to reflect the cancelled state
  const fresh = Store.getOrders().find(o => o.id === orderId);
  if (fresh) updatePlacedModalForOrder(fresh);
});

$('#orderStatusBtn').addEventListener('click', () => {
  // Banner now opens the multi-order popup, not the single-order
  // modal — most customers end up placing 2+ orders so the popup
  // is the more useful default destination.
  openMyOrders();
});

/* ==========================================================
   MY ORDERS  (multi-order popup + FAB + thank-you reset)
   - FAB shows live count of THIS device's pending/preparing.
   - Popup is scrollable, shows every order this device placed,
     and exposes the customer self-cancel button per order while
     the grace window is open.
   - When every order is served and there's nothing pending,
     show the thank-you overlay and clear the table.
   ========================================================== */
let myOrdersTicker = null;

function getMyActiveOrders() {
  return Store.getMyOrders().filter(o => o.status === 'pending' || o.status === 'preparing');
}

/* Active orders for the CURRENT room (any device at this table), so
   the floating bubble is linked to the room rather than to one
   device. After changing rooms an order left behind under the old
   label no longer lights up the badge (FIX1), AND a customer who
   just joined an existing table sees the count even before they've
   ordered anything. Falls back to this device's own active orders
   when no table label is set. The My orders sheet already shows this
   same combined table view, so the badge and the sheet now match. */
function getActiveOrdersHere() {
  const here = state.tableNumber;
  if (!here) return getMyActiveOrders();
  return Store.getTableOrders(here)
    .filter(o => o.status === 'pending' || o.status === 'preparing');
}

function refreshMyOrdersFab() {
  const active = getActiveOrdersHere().length;
  const fab = $('#fabMyOrdersBtn');
  fab.hidden = (active === 0);
  $('#fabMyOrdersBadge').textContent = active;
  // Chat FAB only appears once this table has an order to talk about.
  const chatFab = $('#fabChatBtn');
  if (chatFab) {
    chatFab.hidden = !(state.tableNumber && Store.getTableOrders(state.tableNumber).length > 0);
  }
}

function openMyOrders() {
  const sheet = $('#myOrdersSheet');
  sheet.hidden = false;
  sheet.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => sheet.classList.add('open'));
  renderMyOrdersList();
  // Tick countdowns + auto-refresh items every 1s while open
  if (myOrdersTicker) clearInterval(myOrdersTicker);
  myOrdersTicker = setInterval(renderMyOrdersList, 1000);
  // First-time-only: point out where the Table PIN lives so a
  // newcomer knows what to share with their tablemates.
  if (!pinHintSeen()) {
    requestAnimationFrame(() => {
      if (!sheet.hidden && sheet.querySelector('.myorders-pin')) playPinHint();
    });
  }
}
function closeMyOrders() {
  const sheet = $('#myOrdersSheet');
  clearPinHint();                       // tidy up the hint if still showing
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  setTimeout(() => { sheet.hidden = true; }, 200);
  if (myOrdersTicker) { clearInterval(myOrdersTicker); myOrdersTicker = null; }
}

/* ---- First-time Table-PIN spotlight -------------------------
   Glows the PIN banner and floats a pointer callout beneath it
   so a first-time customer can find the code to share. The
   callout lives on the sheet (not inside #myOrdersList) so the
   1s re-render doesn't wipe it; the banner's `.hint` class is
   re-applied by renderMyOrdersList while `pinHintActive`. */
let pinHintActive = false;
let pinHintTimer  = null;
function pinHintSeen() {
  try { return localStorage.getItem('bb_pin_hint_seen') === '1'; } catch (e) { return false; }
}
function playPinHint() {
  if (pinHintActive) return;
  const sheet  = $('#myOrdersSheet');
  const banner = sheet.querySelector('.myorders-pin');
  if (!banner) return;
  pinHintActive = true;
  banner.classList.add('hint');
  banner.scrollIntoView({ block: 'nearest' });

  const callout = document.createElement('div');
  callout.className = 'pin-hint-callout';
  callout.innerHTML =
    `<span class="pin-hint-arrow" aria-hidden="true">👆</span>` +
    `<span class="pin-hint-text">This is your <strong>Table PIN</strong> — share it so friends can join your order. Tap to dismiss.</span>`;
  sheet.appendChild(callout);

  const place = () => {
    const sr = sheet.getBoundingClientRect();
    const br = banner.getBoundingClientRect();
    callout.style.top   = (br.bottom - sr.top + 8) + 'px';
    callout.style.left  = (br.left   - sr.left)    + 'px';
    callout.style.width = br.width + 'px';
  };
  place();
  requestAnimationFrame(place);

  callout.addEventListener('click', clearPinHint);
  pinHintTimer = setTimeout(clearPinHint, 6500);
}
/* Dismiss the hint (timeout, tap, or sheet close) and remember it
   so it never auto-shows again on this device. */
function clearPinHint() {
  if (pinHintTimer) { clearTimeout(pinHintTimer); pinHintTimer = null; }
  if (!pinHintActive) return;
  pinHintActive = false;
  try { localStorage.setItem('bb_pin_hint_seen', '1'); } catch (e) {}
  const sheet = $('#myOrdersSheet');
  sheet.querySelector('.myorders-pin')?.classList.remove('hint');
  const callout = sheet.querySelector('.pin-hint-callout');
  if (callout) {
    callout.classList.add('leaving');
    setTimeout(() => callout.remove(), 360);
  }
}
$('#fabMyOrdersBtn').addEventListener('click', openMyOrders);
$('#closeMyOrdersBtn').addEventListener('click', closeMyOrders);

/* Orders the customer has "cleared" from their own list (history
   tidy-up). They stay in the store for staff; this just hides them
   from this device's My-orders view. */
function dismissedOrderIds() {
  try { return new Set(JSON.parse(localStorage.getItem('bb_dismissed_orders') || '[]')); }
  catch { return new Set(); }
}
function dismissOrders(ids) {
  const set = dismissedOrderIds();
  ids.forEach(id => set.add(id));
  localStorage.setItem('bb_dismissed_orders', JSON.stringify([...set]));
}
/* Multi-select "clear" mode for the My-orders list. */
let myOrdersSelectMode = false;
const selectedToClear = new Set();

function renderMyOrdersList() {
  const myId = Store.getClientId();
  // Combined view: when the customer is on a table, show the
  // whole table's orders across all devices (so joined tablemates
  // see each other's rounds). Falls back to own orders if no
  // table label is set. Dismissed (cleared) orders are hidden.
  const dismissed = dismissedOrderIds();
  const orders = (state.tableNumber
    ? Store.getTableOrders(state.tableNumber)
    : Store.getMyOrders()).filter(o => !dismissed.has(o.id));
  const host   = $('#myOrdersList');
  const active = orders.filter(o => o.status === 'pending' || o.status === 'preparing').length;
  $('#myOrdersSummary').textContent = active === 0
    ? `${orders.length} total`
    : `${active} active · ${orders.length} total`;

  // Today's spending strip — the customer's OWN non-cancelled
  // orders placed today (don't count tablemates' spending as
  // theirs).
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const todays = orders.filter(o => {
    if (o.clientId !== myId) return false;
    if (o.status === 'cancelled') return false;
    const t = new Date(o.placedAt);
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  });
  const todayTotal = todays.reduce((s, o) => s + (o.total || 0), 0);

  const ctaHtml = `
    <div class="myorders-cta" data-loggedin="false">
      <strong>Today's spending: ${peso(todayTotal)}</strong>
      <p>To save your spending history and earn rewards, sign in or create an account.</p>
      <a href="signup.html" class="btn btn-primary btn-block">Create an account</a>
    </div>
  `;

  if (orders.length === 0) {
    host.innerHTML = `<p class="empty-state">No orders yet.</p>` + ctaHtml;
    return;
  }

  // Table PIN banner — the join code for this table, taken from
  // the customer's own active orders. Shown so they can share it
  // with real tablemates; anyone without it can't pile orders
  // onto this table.
  const activePin = orders
    .filter(o => o.status === 'pending' || o.status === 'preparing')
    .map(o => o.joinPin).find(Boolean);
  const pinHtml = activePin
    ? `<div class="myorders-pin${pinHintActive ? ' hint' : ''}">
         <div class="myorders-pin-text">
           <span>Table PIN</span>
           <strong>${escapeHtml(activePin)}</strong>
           <small>share with your table so they can add orders</small>
         </div>
         <button class="btn btn-ghost myorders-pin-copy" data-act="copy-pin"
                 data-pin="${escapeHtml(activePin)}" aria-label="Copy table PIN">Copy</button>
       </div>`
    : '';

  // People at this table = distinct devices with a non-cancelled
  // order. All of THIS browser's ids (current + past) collapse into a
  // single person so a soft reset on the same device doesn't inflate
  // the count (FIX2); every other distinct clientId counts once.
  // (A full browser cache wipe loses the id history and is the one
  // case this can't collapse — it looks like a genuinely new device.)
  const myIds = new Set(Store.getMyClientIds());
  const otherIds = new Set();
  let meCounted = false;
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    if (myIds.has(o.clientId)) meCounted = true;
    else otherIds.add(o.clientId);
  }
  const headcount = otherIds.size + (meCounted ? 1 : 0);
  const peopleHtml = headcount > 0
    ? `<div class="myorders-people">
         <span class="people-icons">${'<span class="person">👤</span>'.repeat(Math.min(headcount, 5))}${headcount > 5 ? '<span class="person plus">＋</span>' : ''}</span>
         <span class="people-label">${headcount} ${headcount === 1 ? 'person' : 'people'} at this table</span>
       </div>`
    : '';

  // Toolbar: cancel-all (any of MY cancellable orders) + multi-select
  // "clear" of MY finished orders (served/cancelled) from this list.
  const myCancellable = orders.filter(o => o.clientId === myId && Store.isCancellableByCustomer(o));
  const myClearable   = orders.filter(o => o.clientId === myId && (o.status === 'served' || o.status === 'cancelled'));
  const toolbarBtns = [];
  if (myCancellable.length) {
    toolbarBtns.push(`<button class="btn btn-ghost btn-mini" data-act="cancel-all">Cancel all (${myCancellable.length})</button>`);
  }
  if (myClearable.length) {
    toolbarBtns.push(myOrdersSelectMode
      ? `<button class="btn btn-ghost btn-mini" data-act="clear-selected">Clear selected${selectedToClear.size ? ` (${selectedToClear.size})` : ''}</button>
         <button class="btn btn-ghost btn-mini" data-act="select-done">Done</button>`
      : `<button class="btn btn-ghost btn-mini" data-act="select-clear">Select to clear</button>`);
  }
  const toolbarHtml = toolbarBtns.length
    ? `<div class="myorders-toolbar">${toolbarBtns.join('')}</div>` : '';

  const orderRows = orders.map(o => {
    const info  = STATUS_INFO[o.status] || STATUS_INFO.pending;
    const isMine = o.clientId === myId;
    const selectable = myOrdersSelectMode && isMine && (o.status === 'served' || o.status === 'cancelled');
    const itemsHtml = o.items.map(i => {
      const menuItem = MENU.find(m => m.id === i.itemId);
      const img   = menuItem && menuItem.img;
      const emoji = (menuItem && menuItem.emoji) || '☕';
      const thumb = `<span class="myo-thumb">${img ? `<img src="${img}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}<span class="myo-thumb-ph">${emoji}</span></span>`;
      return `<li>${thumb}<span class="myo-name">${i.qty}× ${escapeHtml(i.name)}</span><span class="myo-price">${peso(i.unitPrice * i.qty)}</span></li>`;
    }).join('');
    // Only the customer who placed an order can cancel it — a
    // tablemate's order is read-only in your view.
    const cancellable = isMine && Store.isCancellableByCustomer(o);
    const secs = Math.ceil(Store.cancelWindowRemaining(o) / 1000);
    return `
      <article class="myorder-item" data-id="${o.id}" data-status="${o.status}">
        <header>
          <div>
            ${selectable ? `<label class="myo-select"><input type="checkbox" data-clear-id="${o.id}"${selectedToClear.has(o.id) ? ' checked' : ''} aria-label="Select to clear"></label>` : ''}
            <strong>Order #${o.number}</strong>
            <span class="myorder-who ${isMine ? 'mine' : ''}">${isMine ? 'you' : 'tablemate'}</span>
            <small class="muted"> · ${timeAgo(new Date(o.placedAt))}</small>
          </div>
          <span class="status-pill status-${o.status}">${o.status}</span>
        </header>
        <ul>${itemsHtml}</ul>
        <div class="myorder-total"><span>Total</span><strong>${peso(o.total)}</strong></div>
        <footer>
          <span class="myorder-status-icon" aria-hidden="true">${info.icon}</span>
          <span class="myorder-status-text">${info.text}</span>
          ${cancellable
            ? `<button class="btn btn-ghost btn-modify-grace" data-act="modify">
                 Modify <span class="cancel-countdown">${secs}s</span>
               </button>
               <button class="btn btn-cancel-grace" data-act="cancel">
                 Cancel <span class="cancel-countdown">${secs}s</span>
               </button>`
            : ''}
        </footer>
      </article>
    `;
  }).join('');
  host.innerHTML = peopleHtml + pinHtml + toolbarHtml + orderRows + ctaHtml;
}

/* Track checkbox selection for the "clear" multi-select (the 1s
   re-render reads selectedToClear back, so state survives). */
$('#myOrdersList').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-clear-id]');
  if (!cb) return;
  if (cb.checked) selectedToClear.add(cb.dataset.clearId);
  else            selectedToClear.delete(cb.dataset.clearId);
});

$('#myOrdersList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  // ----- Toolbar / banner actions (not tied to a single order) -----
  if (act === 'copy-pin') {
    await copyTextToClipboard(btn.dataset.pin || '');
    showToast('Table PIN copied', 'success');
    return;
  }
  if (act === 'cancel-all') {
    const myId = Store.getClientId();
    const targets = Store.getMyOrders().filter(o => Store.isCancellableByCustomer(o));
    if (!targets.length) return;
    if (!confirm(`Cancel all ${targets.length} of your open order${targets.length === 1 ? '' : 's'}?`)) return;
    let ok = 0;
    targets.forEach(o => { if (Store.customerCancelOrder(o.id).ok) ok++; });
    showToast(ok ? `Cancelled ${ok} order${ok === 1 ? '' : 's'}` : 'Nothing could be cancelled', ok ? 'success' : 'error');
    renderMyOrdersList(); refreshMyOrdersFab(); refreshOrderStatusBanner();
    return;
  }
  if (act === 'select-clear') { myOrdersSelectMode = true;  selectedToClear.clear(); renderMyOrdersList(); return; }
  if (act === 'select-done')  { myOrdersSelectMode = false; selectedToClear.clear(); renderMyOrdersList(); return; }
  if (act === 'clear-selected') {
    if (!selectedToClear.size) { showToast('Select orders to clear first', 'error'); return; }
    dismissOrders([...selectedToClear]);
    showToast(`Cleared ${selectedToClear.size} from your list`, 'success');
    myOrdersSelectMode = false; selectedToClear.clear();
    renderMyOrdersList(); refreshMyOrdersFab(); refreshOrderStatusBanner();
    return;
  }

  // ----- Per-order actions -----
  const card = btn.closest('.myorder-item');
  if (!card) return;
  const id = card.dataset.id;

  if (act === 'modify') {
    const order = Store.getOrders().find(o => o.id === id);
    if (!order) return;
    if (!Store.isCancellableByCustomer(order)) {
      showToast('Modify window expired — ask staff.', 'error');
      renderMyOrdersList();
      return;
    }
    startEditingOrder(order);
    return;
  }

  if (act === 'cancel') {
    if (!confirm('Cancel this order?')) return;
    const result = Store.customerCancelOrder(id);
    if (!result.ok) {
      showToast(
        result.reason === 'already_started' ? 'Already being prepared — ask staff.' :
        result.reason === 'window_expired'  ? 'Cancel window expired — ask staff.'  :
        'Could not cancel.',
        'error'
      );
    } else {
      showToast('Order cancelled', 'success');
    }
    renderMyOrdersList();
    refreshMyOrdersFab();
    refreshOrderStatusBanner();
  }
});

/* Thank-you flow — runs whenever the customer has at least one
   order in their history but zero are active. Triggers once per
   "round" (uses a flag in state so we don't re-show it after the
   customer hits Dismiss). */
let thanksShown = false;
function maybeShowThanks() {
  // Staff are exempt from the customer end-of-visit flow. The
  // thanks overlay + auto table-reset exists to free a table for
  // the next walk-in — it's meaningless for an admin, whose name
  // is auto-stamped as their table label. Without this guard the
  // overlay pops over the admin panel the moment the admin's own
  // orders all reach "served" (the customer-side poll runs even
  // while the panel is open). Admins can still order like a
  // normal customer; they just never get the reset lifecycle.
  if (Store.isAdmin()) return;
  const mine = Store.getMyOrders();
  if (mine.length === 0) return;
  const active = mine.filter(o => o.status === 'pending' || o.status === 'preparing').length;
  const anyServed = mine.some(o => o.status === 'served');
  if (active === 0 && anyServed && !thanksShown) {
    thanksShown = true;
    showThanksOverlay();
  }
}
/* Tracks the auto-reset timer so a customer choosing "Continue
   as same user" can cancel the impending reset cleanly. */
let thanksAutoResetTimer = null;
function showThanksOverlay() {
  const ov = $('#thanksOverlay');
  ov.hidden = false;
  ov.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => ov.classList.add('open'));
  launchConfetti();
  // 30-second safety auto-reset for the case where the customer
  // just walks away from the device. Both action buttons cancel
  // it explicitly.
  if (thanksAutoResetTimer) clearTimeout(thanksAutoResetTimer);
  thanksAutoResetTimer = setTimeout(resetForNextCustomer, 30000);
}

/* Lightweight confetti — spawns ~50 colored bits inside the
   thank-you card that fall + fade, then clean themselves up.
   Pure CSS animation, no library. */
function launchConfetti() {
  const host = $('#confettiLayer');
  if (!host) return;
  host.innerHTML = '';
  const colors = ['#C18F1E', '#A0855E', '#3A6E3B', '#E8B84B', '#6F5A3E', '#DDC9A8'];
  const N = 50;
  for (let i = 0; i < N; i++) {
    const bit = document.createElement('span');
    bit.className = 'confetti-bit';
    bit.style.left = Math.random() * 100 + '%';
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = (Math.random() * 0.25) + 's';
    bit.style.animationDuration = (1 + Math.random() * 0.9) + 's';
    bit.style.transform = `rotate(${Math.random() * 360}deg)`;
    if (i % 3 === 0) bit.style.borderRadius = '50%';
    host.appendChild(bit);
  }
  // Remove after the longest possible run so they don't linger.
  setTimeout(() => { host.innerHTML = ''; }, 2400);
}
function dismissThanks() {
  const ov = $('#thanksOverlay');
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
  setTimeout(() => { ov.hidden = true; }, 250);
  if (thanksAutoResetTimer) { clearTimeout(thanksAutoResetTimer); thanksAutoResetTimer = null; }
}

/* "Continue as the SAME user" — keep clientId, keep table
   label, just hide the thanks overlay and let the customer
   browse the menu again. Their served orders stay in My Orders
   as history; new orders will append. The reset lockout flips
   back to false so a fresh round of "all served" will retrigger
   the thanks card later. */
function continueAsSameUser() {
  dismissThanks();
  closeMyOrders();
  thanksShown = false;
  bumpInactivity();
  showToast('Welcome back ☕ Add anything else?', 'success');
}
function resetForNextCustomer() {
  // Forget this device's order history scope by clearing the
  // active-order pointer and the table label. Orders remain in
  // the store for the admin to clear/serve.
  const leaving = state.tableNumber;     // capture before setTableLabel(null) wipes it
  clearActiveOrder();
  finishEditingOrder();             // drop any in-progress order edit
  setTableLabel(null);
  Store.clearSessionTable();        // forget the 24h guest persistence
  clearCart();
  closeMyOrders();
  dismissThanks();
  // Abolish the room: once the visit truly ends, wipe this table's
  // chat thread so the next customer who reuses the label starts
  // fresh — and the previous customer's own messages can't reappear
  // flipped to the wrong side once the clientId below changes (BUG1).
  // Guarded so we never nuke a SHARED table's chat while a tablemate
  // still has an order in flight.
  if (leaving && Store.findActiveOrdersByTable(leaving).length === 0) {
    Store.clearThread(leaving);
    if (chatThread === leaving) {
      chatMessages = [];
      if (chatDrawer.classList.contains('open')) closeChat();
      else renderChatMessages();
    }
  }
  // Mint a fresh clientId so the next customer at this device
  // sees a clean "My orders" list — the previous customer's
  // orders remain in the store (visible to admin) but stop
  // matching this browser's Store.getMyOrders().
  Store.resetClientId();
  thanksShown = false;
  refreshMyOrdersFab();
  // Force the customer back to the table prompt — they cannot
  // start ordering again without picking a table.
  openTableModal();
}

/* ==========================================================
   INACTIVITY RESET
   - If the customer hasn't interacted with the page for
     INACTIVITY_MS, AND they have no in-flight orders, we
     consider them gone and reset to the table prompt.
   - Customers waiting on a drink are never kicked out.
   ========================================================== */
const INACTIVITY_MS = 5 * 60 * 1000;
let inactivityDeadline = Date.now() + INACTIVITY_MS;
function bumpInactivity() { inactivityDeadline = Date.now() + INACTIVITY_MS; }
['click', 'touchstart', 'keydown', 'scroll', 'pointerdown'].forEach(ev =>
  document.addEventListener(ev, bumpInactivity, { passive: true })
);
setInterval(() => {
  if (Date.now() < inactivityDeadline) return;
  // Signed-in admins are never timed out — they're staff, not
  // walk-in customers. Their session expiry is handled by the
  // 8-hour bb_session TTL in store.js instead.
  const session = Store.getSession();
  if (session && session.role === 'admin') { bumpInactivity(); return; }
  // Don't disturb customers who have orders in flight — they're
  // still on the premises waiting for food.
  if (getMyActiveOrders().length > 0) { bumpInactivity(); return; }
  // Don't double-fire while the table modal is already open.
  if ($('#tableModal').classList.contains('open')) { bumpInactivity(); return; }
  // Nothing to lose — wipe and prompt.
  if (state.tableNumber || state.cart.length > 0) {
    resetForNextCustomer();
  } else {
    openTableModal();
  }
  bumpInactivity();
}, 30 * 1000);
$('#thanksSameUserBtn').addEventListener('click', continueAsSameUser);
$('#thanksNewUserBtn').addEventListener('click', resetForNextCustomer);

/* ==========================================================
   MODAL HELPERS
   ========================================================== */
function openModal(sel) {
  const m = $(sel);
  if (!m) return;
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeModal(sel) {
  const m = $(sel);
  if (!m) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
function bindBackdropClose(sel, onClose) {
  const m = $(sel);
  if (!m) return;
  let started = false;
  m.addEventListener('mousedown', e => { started = (e.target === m); });
  m.addEventListener('mouseup',   e => { if (started && e.target === m) onClose(); started = false; });
}
bindBackdropClose('#customizerModal', closeCustomizer);
bindBackdropClose('#staffLoginModal', closeStaffLogin);
bindBackdropClose('#itemModal',        closeItemModal);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('#customizerModal').classList.contains('open'))    return closeCustomizer();
  if ($('#staffLoginModal').classList.contains('open'))    return closeStaffLogin();
  if ($('#itemModal').classList.contains('open'))          return closeItemModal();
  if ($('#dupTableModal').classList.contains('open'))      return; // force a choice
  if ($('#orderPlacedModal').classList.contains('open'))   return closeModal('#orderPlacedModal');
  if (!$('#myOrdersSheet').hidden)                         return closeMyOrders();
  if (cartDrawer.classList.contains('open'))               return closeCart();
});

/* ==========================================================
   STAFF LOGIN
   ========================================================== */
const staffLoginModal = $('#staffLoginModal');
function openStaffLogin()  { openModal('#staffLoginModal'); }
function closeStaffLogin() {
  closeModal('#staffLoginModal');
  $('#staffLoginError').hidden = true;
  // Cancelling the staff login from the table flow leaves the
  // customer with no table set AND no modal showing — they
  // could browse the menu un-tabled, breaking the "always
  // require table" rule. Reopen the table prompt unless a
  // signed-in admin already exists.
  const session = Store.getSession();
  const isAdmin = !!session && session.role === 'admin';
  if (!state.tableNumber && !isAdmin) {
    openTableModal();
  }
}
/* Footer button is dual-purpose: when no admin session is
   active it opens Staff Login; when one IS active it signs
   out instead — so a logged-in admin can never accidentally
   "log in again" from the customer view. */
$('#openStaffLoginBtn').addEventListener('click', () => {
  if ($('#openStaffLoginBtn').dataset.mode === 'signout') {
    adminSignOut();
  } else {
    openStaffLogin();
  }
});
$('#tableStaffLoginBtn').addEventListener('click', () => {
  closeTableModal();
  openStaffLogin();
});

/* Header Admin shortcut — visible only when a staff session
   is active. Click enters the admin panel directly. Also
   re-labels the footer Staff Login button so a signed-in
   admin can sign out from the customer view instead of
   accidentally trying to log in again. */
function refreshAdminHeaderBtn() {
  const session = Store.getSession();
  const isAdmin = !!session && session.role === 'admin';
  const loggedIn = !!session;          // any account (admin or future customer)
  $('#adminTopbarBtn').hidden = !isAdmin;
  const footerBtn = $('#openStaffLoginBtn');
  if (footerBtn) {
    footerBtn.textContent = isAdmin ? 'Sign out' : 'Staff Login';
    footerBtn.dataset.mode = isAdmin ? 'signout' : 'signin';
  }
  // Table-strip action: a logged-in account's table label IS
  // their account identity, so they can't freely re-type it —
  // the "change" link becomes "Log out" instead. Guests keep
  // "change" so they can correct a typo'd table name.
  const tableBtn = $('#changeTableBtn');
  if (tableBtn) {
    tableBtn.textContent     = loggedIn ? 'Log out' : 'change';
    tableBtn.dataset.mode    = loggedIn ? 'logout' : 'change';
  }
}
$('#adminTopbarBtn').addEventListener('click', () => {
  const session = Store.getSession();
  if (session && session.role === 'admin') enterAdminPanel(session);
});
$('#closeStaffLoginBtn').addEventListener('click', closeStaffLogin);

$('#staffLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#staffLoginError');
  errEl.hidden = true;
  const fd = new FormData(e.target);
  try {
    await Store.seedIfEmpty();      // ensure default admin exists before hashing
    const session = await Store.login({
      email:    fd.get('email'),
      password: fd.get('password'),
    });
    showToast(`Welcome, ${session.name}`, 'success');
    e.target.reset();
    closeStaffLogin();
    // If the table prompt was still up (admin signed in before
    // setting a table), dismiss it — admins aren't required to
    // pick a table to access the panel. Auto-stamp the table
    // label with their authenticated name so any order they
    // place from the customer view is attributed to them.
    closeTableModal();
    // Sever the guest persona: a fresh clientId means the staff
    // member doesn't inherit ownership of orders placed earlier
    // on this device as a guest (those stay visible in the admin
    // panel, just not in the admin's customer "My orders"). Also
    // drop the tracked active order + refresh the customer
    // surfaces so the guest's banner/FAB don't linger.
    Store.resetClientId();
    clearActiveOrder();
    refreshMyOrdersFab();
    setTableLabel(session.name || session.email);
    enterAdminPanel(session);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

/* ==========================================================
   ADMIN PANEL
   ========================================================== */
const adminPanel = $('#adminPanel');

/* Sync-status badge — reflects Store's sync state so an admin
   can tell at a glance whether orders are reaching the cloud.
   Hidden entirely in local mode (no backend to be out of sync
   with). */
(function wireSyncBadge() {
  const badge = $('#syncBadge');
  const label = $('#syncLabel');
  if (!badge || !Store.isRemote || !Store.isRemote()) return;
  Store.onSyncChange((s) => {
    badge.hidden = false;
    badge.dataset.state = s.status;
    if (s.status === 'offline')      label.textContent = 'Offline';
    else if (s.status === 'error')   label.textContent = 'Reconnecting…';
    else if (s.pendingCount > 0)     label.textContent = `Syncing ${s.pendingCount}…`;
    else if (s.status === 'syncing') label.textContent = 'Syncing…';
    else                             label.textContent = 'Synced';
    // Amber when there's a backlog even if the transport is "idle".
    if (s.pendingCount > 0 && s.status === 'idle') badge.dataset.state = 'pending';
  });
})();

function enterAdminPanel(session) {
  // Defense-in-depth: even if a caller passes a fabricated
  // session object (e.g. via DevTools), re-verify against the
  // store's persisted session before unhiding the panel. The
  // panel is the surface for every destructive action; trusting
  // the caller is not enough.
  const verified = Store.getSession();
  if (!verified || verified.role !== 'admin') {
    console.warn('[admin] entry blocked — no valid admin session');
    return false;
  }
  // Caller's session object might be stale; prefer the verified
  // one for the displayed name.
  session = verified;
  adminPanel.hidden = false;
  $('#adminUserName').textContent = session.name || session.email;
  switchAdminTab('orders');
  renderOrders();
  loadSettingsForm();
  refreshAdminHeaderBtn();
  refreshAdminActivity();
  startAdminSessionWatcher();
  // Lock the page-level scroll so we only get the panel's
  // .admin-content scrollbar — not a second one from the
  // customer view underneath. Uses a class so the modal
  // open/close inline-style toggles don't clobber it.
  document.body.classList.add('admin-open');
  return true;
}

/* L1 — Session expiry watcher. While the admin panel is open
   we re-check Store.isAdmin() every 30 seconds. When the 8-hour
   bb_session TTL elapses (or another tab signs out), this fires
   and force-closes the panel with a notice. Without this, an
   admin who walked away could leave the panel "open" for hours
   past their session and any clicks would still go through the
   open RLS policies. */
let adminSessionWatchTimer = null;
function startAdminSessionWatcher() {
  if (adminSessionWatchTimer) return;
  adminSessionWatchTimer = setInterval(() => {
    if (adminPanel.hidden) {
      clearInterval(adminSessionWatchTimer);
      adminSessionWatchTimer = null;
      return;
    }
    if (!Store.isAdmin()) {
      clearInterval(adminSessionWatchTimer);
      adminSessionWatchTimer = null;
      exitAdminPanel();
      refreshAdminHeaderBtn();
      showToast('Your session expired — please sign in again', 'error');
    }
  }, 30 * 1000);
}
function exitAdminPanel()  {
  adminPanel.hidden = true;
  refreshAdminHeaderBtn();
  document.body.classList.remove('admin-open');
}
function adminSignOut() {
  const wasSession = Store.getSession();
  Store.logout();
  exitAdminPanel();
  refreshAdminHeaderBtn();
  // Fresh clientId again, so the next guest on this device starts
  // with a clean customer "My orders" (no bleed from staff orders).
  Store.resetClientId();
  clearActiveOrder();
  refreshMyOrdersFab();
  // The auto-stamped admin-name table belongs to that session.
  // Clearing it on sign-out drops the visitor back to the
  // unauthenticated customer flow (forced table prompt).
  if (wasSession && state.tableNumber === (wasSession.name || wasSession.email)) {
    setTableLabel(null);
    openTableModal();
  }
  showToast('Signed out');
}
$('#exitAdminBtn').addEventListener('click', exitAdminPanel);
$('#adminLogoutBtn').addEventListener('click', adminSignOut);

function switchAdminTab(tab) {
  $$('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.adminTab === tab));
  $$('.admin-pane').forEach(p => p.hidden = (p.dataset.adminPane !== tab));
  if (tab === 'orders')   renderOrders();
  if (tab === 'menu')   { renderMenuCatFilter(); renderMenuTable(); }
  if (tab === 'settings') loadSettingsForm();
}
$$('.admin-tab').forEach(t => t.addEventListener('click', () => switchAdminTab(t.dataset.adminTab)));

/* ----- Orders panel ----- */
function refreshOrdersBadge() {
  const active = Store.getOrders().filter(o => o.status === 'pending' || o.status === 'preparing').length;
  $('#ordersBadge').textContent = active;
}

/* Day-of stats strip at the top of the Orders pane. Revenue
   counts only orders SERVED today (matches what's actually
   been collected at the counter). */
function refreshDayStats() {
  const orders = Store.getOrders();
  const now    = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const sameDay = (iso) => {
    if (!iso) return false;
    const t = new Date(iso);
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  };

  const servedToday = orders.filter(o => o.status === 'served' && sameDay(o.servedAt));
  const revenue     = servedToday.reduce((s, o) => s + (o.total || 0), 0);
  const active      = orders.filter(o => o.status === 'pending' || o.status === 'preparing').length;

  $('#dayRevenue').textContent = peso(revenue);
  $('#dayServed').textContent  = servedToday.length;
  $('#dayActive').textContent  = active;
}

function renderOrders() {
  const filter = $('#orderFilter').value;
  let orders = Store.getOrders();
  if (filter === 'active')     orders = orders.filter(o => o.status === 'pending' || o.status === 'preparing');
  else if (filter !== 'all')   orders = orders.filter(o => o.status === filter);
  // Kitchen works first-come-first-served: oldest order on top,
  // newest at the bottom (Store keeps them newest-first for the
  // customer views, so reverse to a FIFO queue for staff).
  orders = orders.slice().sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));

  const host = $('#ordersList');
  if (orders.length === 0) {
    host.innerHTML = `<p class="empty-state">No orders match this filter.</p>`;
    refreshOrdersBadge();
    return;
  }

  host.innerHTML = orders.map(o => {
    const placedAgo = timeAgo(new Date(o.placedAt));
    const itemsHtml = o.items.map(i => `
      <li>
        <span>${i.qty}× <strong>${escapeHtml(i.name)}</strong>${i.summary ? `<small> — ${escapeHtml(i.summary)}</small>` : ''}</span>
        <span>${peso(i.unitPrice * i.qty)}</span>
      </li>
    `).join('');
    const tableLabel = o.tableNumber ? escapeHtml(String(o.tableNumber)) : '—';
    const cancellable = Store.isCancellableByCustomer(o);
    const secs = Math.ceil(Store.cancelWindowRemaining(o) / 1000);
    return `
      <article class="order-card${orderSelectMode ? ' selectable' : ''}" data-id="${o.id}" data-status="${o.status}">
        <header class="order-head">
          <div class="order-head-id">
            ${orderSelectMode ? `<label class="order-select"><input type="checkbox" data-order-select="${o.id}"${selectedOrders.has(o.id) ? ' checked' : ''} aria-label="Select order"></label>` : ''}
            <h3>#${o.number}</h3>
            <span class="table-tag" title="Table">
              <span class="table-tag-label">Table</span>
              <strong>${tableLabel}</strong>
            </span>
          </div>
          <div class="order-head-status">
            <span class="status-pill status-${o.status}">${o.status}</span>
            ${cancellable
              ? `<span class="cancellable-badge" title="Customer can still cancel">
                   ⏱ cancellable <span data-cancel-countdown="${o.id}">${secs}s</span>
                 </span>`
              : ''}
          </div>
        </header>
        <div class="order-meta">placed ${placedAgo}</div>
        <ul>${itemsHtml}</ul>
        <div class="order-total">
          <span>Total</span>
          <span>${peso(o.total)}</span>
        </div>
        <div class="order-actions">
          ${o.status === 'pending'    ? `<button class="btn btn-prep"   data-act="preparing">Mark preparing</button>` : ''}
          ${o.status === 'pending'    ? `<button class="btn btn-ghost"  data-act="modify">✎ Modify</button>` : ''}
          ${o.status === 'preparing'  ? `<button class="btn btn-serve"  data-act="served">Mark served</button>`        : ''}
          ${o.status !== 'served' && o.status !== 'cancelled'
            ? `<button class="btn btn-danger" data-act="cancelled">Cancel</button>` : ''}
          <button class="btn btn-ghost chat-act-btn" data-act="chat">💬 Chat${adminUnreadThreads.has(String(o.tableNumber)) ? '<span class="chat-act-dot" aria-label="unread message"></span>' : ''}</button>
          <button class="btn btn-ghost" data-act="receipt">🧾 Receipt</button>
          <button class="btn btn-ghost" data-act="delete">Delete</button>
        </div>
      </article>
    `;
  }).join('');
  refreshOrdersBadge();
  refreshDayStats();
}

$('#orderFilter').addEventListener('change', renderOrders);
$('#clearServedBtn').addEventListener('click', () => {
  if (!confirm('Clear all served orders?')) return;
  Store.clearServedOrders();
  renderOrders();
});

$('#ordersList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.order-card');
  const id = card.dataset.id;
  const act = btn.dataset.act;
  const order = Store.getOrders().find(o => o.id === id);
  const label = order ? `#${order.number}` : 'Order';
  if (act === 'chat') {
    if (order) openChat(order.tableNumber, 'admin');
    return;
  }
  if (act === 'receipt') {
    if (order) openReceiptModal(order);
    return;
  }
  if (act === 'modify') {
    if (order) openAdminEditOrder(order);
    return;
  }
  if (act === 'delete') {
    if (!confirm('Delete this order?')) return;
    Store.deleteOrder(id);
    knownOrderIds.delete(id);
    ORDER_STATUS_BY_ID.delete(id);
    showAdminToast({ title: `${label} deleted`, variant: 'danger' });
  } else if (act === 'preparing' || act === 'served' || act === 'cancelled') {
    Store.updateOrderStatus(id, act);
    // Seed the snapshot with the new status so this same tab's
    // customer-side poll doesn't surface a status-change toast
    // to the admin themselves for an action they just took.
    ORDER_STATUS_BY_ID.set(id, act);
    showAdminToast({
      title: `${label} → ${act}`,
      variant: act === 'served' ? 'success' : act === 'cancelled' ? 'danger' : 'info',
    });
  } else {
    return;
  }
  renderOrders();
  refreshAdminActivity();
});

/* ----- Admin multi-select delete (orders) ----- */
let orderSelectMode = false;
const selectedOrders = new Set();
$('#orderSelectToggle').addEventListener('click', () => {
  orderSelectMode = !orderSelectMode;
  selectedOrders.clear();
  $('#orderSelectToggle').textContent = orderSelectMode ? 'Cancel select' : 'Select';
  $('#deleteSelectedOrdersBtn').hidden = !orderSelectMode;
  renderOrders();
});
$('#ordersList').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-order-select]');
  if (!cb) return;
  if (cb.checked) selectedOrders.add(cb.dataset.orderSelect);
  else            selectedOrders.delete(cb.dataset.orderSelect);
  $('#deleteSelectedOrdersBtn').textContent = selectedOrders.size
    ? `Delete selected (${selectedOrders.size})` : 'Delete selected';
});
$('#deleteSelectedOrdersBtn').addEventListener('click', () => {
  if (!selectedOrders.size) { showAdminToast({ title: 'No orders selected', variant: 'info' }); return; }
  if (!confirm(`Delete ${selectedOrders.size} selected order${selectedOrders.size === 1 ? '' : 's'}?`)) return;
  const n = selectedOrders.size;
  selectedOrders.forEach(id => {
    Store.deleteOrder(id);
    knownOrderIds.delete(id);
    ORDER_STATUS_BY_ID.delete(id);
  });
  selectedOrders.clear();
  orderSelectMode = false;
  $('#orderSelectToggle').textContent = 'Select';
  $('#deleteSelectedOrdersBtn').hidden = true;
  $('#deleteSelectedOrdersBtn').textContent = 'Delete selected';
  showAdminToast({ title: `Deleted ${n} order${n === 1 ? '' : 's'}`, variant: 'danger' });
  renderOrders();
  refreshAdminActivity();
});

/* ----- Admin order modify modal ----- */
let adminEditOrderId = null;
let adminEditItems = [];
function openAdminEditOrder(order) {
  if (order.status !== 'pending') {
    showAdminToast({ title: 'Can only modify before preparing', variant: 'info' });
    return;
  }
  adminEditOrderId = order.id;
  adminEditItems = JSON.parse(JSON.stringify(order.items || []));
  $('#adminEditOrderNum').textContent = order.number;
  $('#adminEditOrderError').hidden = true;
  renderAdminEditItems();
  openModal('#adminEditOrderModal');
}
function renderAdminEditItems() {
  const host = $('#adminEditOrderItems');
  if (!adminEditItems.length) {
    host.innerHTML = `<p class="empty-state">No items left — removing all will block save.</p>`;
  } else {
    host.innerHTML = adminEditItems.map((it, idx) => `
      <div class="admin-edit-row" data-idx="${idx}">
        <span class="admin-edit-name">${it.qty}× ${escapeHtml(it.name)}${it.summary ? `<small> — ${escapeHtml(it.summary)}</small>` : ''}</span>
        <div class="qty-stepper">
          <button type="button" data-eit-dec="${idx}" aria-label="Less">−</button>
          <span>${it.qty}</span>
          <button type="button" data-eit-inc="${idx}" aria-label="More">+</button>
        </div>
        <span class="admin-edit-price">${peso(it.unitPrice * it.qty)}</span>
        <button type="button" class="icon-btn" data-eit-rem="${idx}" aria-label="Remove">✕</button>
      </div>`).join('');
  }
  const total = adminEditItems.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  $('#adminEditOrderTotal').textContent = peso(total);
}
$('#adminEditOrderItems').addEventListener('click', (e) => {
  const inc = e.target.closest('[data-eit-inc]');
  const dec = e.target.closest('[data-eit-dec]');
  const rem = e.target.closest('[data-eit-rem]');
  if (inc) { const i = +inc.dataset.eitInc; adminEditItems[i].qty++; renderAdminEditItems(); }
  if (dec) { const i = +dec.dataset.eitDec; if (adminEditItems[i].qty > 1) { adminEditItems[i].qty--; renderAdminEditItems(); } }
  if (rem) { const i = +rem.dataset.eitRem; adminEditItems.splice(i, 1); renderAdminEditItems(); }
});
function closeAdminEditOrder() { closeModal('#adminEditOrderModal'); adminEditOrderId = null; adminEditItems = []; }
$('#closeAdminEditOrderBtn').addEventListener('click', closeAdminEditOrder);
$('#cancelAdminEditOrderBtn').addEventListener('click', closeAdminEditOrder);
bindBackdropClose('#adminEditOrderModal', closeAdminEditOrder);
$('#saveAdminEditOrderBtn').addEventListener('click', () => {
  if (!adminEditOrderId) return;
  const err = $('#adminEditOrderError');
  if (!adminEditItems.length) { err.textContent = 'Add at least one item (or delete the order instead).'; err.hidden = false; return; }
  const result = Store.updateOrderItems(adminEditOrderId, adminEditItems);
  if (!result.ok) {
    err.textContent = result.reason === 'already_started'
      ? 'Too late — this order is already being prepared.' : 'Could not save changes.';
    err.hidden = false;
    return;
  }
  ORDER_STATUS_BY_ID.set(adminEditOrderId, result.order.status);
  showAdminToast({ title: `Order #${result.order.number} modified`, variant: 'success' });
  closeAdminEditOrder();
  renderOrders();
  refreshAdminActivity();
});

/* Auto-refresh orders every 3s while the admin panel is open
   (drives the cross-DEVICE realtime feel — the same-browser
   cross-tab case uses the storage event for instant updates).
   Always runs reactToAdminOrderChanges() so a new order placed
   on another device is announced via toast regardless of which
   tab the admin is in. */
setInterval(() => {
  if (adminPanel.hidden) return;
  reactToAdminOrderChanges();
}, 3000);

/* Live-tick the cancellable countdown badges every second so
   admins see exactly when the customer's self-cancel window
   closes. Cheaper than re-rendering — we only update the span
   text. Skips work entirely when the panel isn't visible. */
setInterval(() => {
  if (adminPanel.hidden) return;
  if ($('.admin-tab.active').dataset.adminTab !== 'orders') return;
  let needsRerender = false;
  $$('[data-cancel-countdown]').forEach(el => {
    const id    = el.dataset.cancelCountdown;
    const order = Store.getOrders().find(o => o.id === id);
    if (!order || !Store.isCancellableByCustomer(order)) {
      needsRerender = true;
      return;
    }
    el.textContent = Math.ceil(Store.cancelWindowRemaining(order) / 1000) + 's';
  });
  if (needsRerender) renderOrders();
}, 1000);

/* ----- Menu admin table ----- */
/* Admin menu view state: which category is filtered, whether rows
   are grouped under category headers, and the active column sort. */
let adminMenuCategory = 'all';
let menuGroupBy = true;
let menuSort = { key: 'name', dir: 'asc' };

/* Category filter chips above the menu table (data-driven). */
function renderMenuCatFilter() {
  const host = $('#menuCatFilter');
  if (!host) return;
  const cats = Store.getCategories();
  if (adminMenuCategory !== 'all' && !cats.some(c => c.id === adminMenuCategory)) {
    adminMenuCategory = 'all';
  }
  const chip = (id, label) =>
    `<button class="chip${adminMenuCategory === id ? ' active' : ''}" data-cat="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
  host.innerHTML = chip('all', 'All') + cats.map(c => chip(c.id, c.label)).join('');
}

function categoryLabel(id) {
  return (Store.getCategories().find(c => c.id === id)?.label) || id || '—';
}

function updateMenuSortIndicators() {
  $$('#menuTable thead th.sortable').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    arrow.textContent = (th.dataset.sort === menuSort.key)
      ? (menuSort.dir === 'asc' ? '▲' : '▼')
      : '';
    th.classList.toggle('sorted', th.dataset.sort === menuSort.key);
  });
}

function renderMenuTable() {
  const search = $('#menuSearch').value.trim().toLowerCase();
  let items = Store.getMenu().filter(it =>
    (!search || `${it.name} ${categoryLabel(it.category)}`.toLowerCase().includes(search)) &&
    (adminMenuCategory === 'all' || it.category === adminMenuCategory)
  );

  // Column sort.
  const dir = menuSort.dir === 'desc' ? -1 : 1;
  const keyOf = (it) => {
    switch (menuSort.key) {
      case 'price':    return Number(it.price) || 0;
      case 'category': return categoryLabel(it.category).toLowerCase();
      case 'tag':      return (it.tag || '').toLowerCase();
      default:         return (it.name || '').toLowerCase();
    }
  };
  items.sort((a, b) => {
    const av = keyOf(a), bv = keyOf(b);
    return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
  });

  const body = $('#menuTableBody');
  if (items.length === 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--ink-soft)">No items.</td></tr>`;
    updateMenuSortIndicators();
    return;
  }

  const rowHtml = (it) => `
    <tr data-id="${it.id}">
      <td>${menuSelectMode ? `<input type="checkbox" class="menu-select" data-menu-select="${it.id}"${selectedMenu.has(it.id) ? ' checked' : ''} aria-label="Select item">` : `<img class="thumb" src="${it.img || ''}" alt="" onerror="this.style.display='none'">`}</td>
      <td><strong>${escapeHtml(it.name)}</strong></td>
      <td>${escapeHtml(categoryLabel(it.category))}</td>
      <td>${peso(it.price)}</td>
      <td>${it.tag ? `<span class="tag">${escapeHtml(it.tag)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="right">
        <div class="row-actions">
          <button class="btn btn-ghost"  data-act="edit"   data-id="${it.id}">Edit</button>
          <button class="btn btn-danger" data-act="delete" data-id="${it.id}">Delete</button>
        </div>
      </td>
    </tr>`;

  if (menuGroupBy) {
    // Group rows under category headers, ordered by the category
    // list (then any orphaned/unknown category last).
    const groups = new Map();
    for (const it of items) {
      const key = it.category || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const cats = Store.getCategories();
    const ordered = cats.map(c => c.id).filter(id => groups.has(id))
      .concat([...groups.keys()].filter(k => !cats.some(c => c.id === k)));
    body.innerHTML = ordered.map(key => {
      const rows = groups.get(key).map(rowHtml).join('');
      return `<tr class="menu-group-row"><td colspan="6">${escapeHtml(categoryLabel(key))} <span class="muted">(${groups.get(key).length})</span></td></tr>` + rows;
    }).join('');
  } else {
    body.innerHTML = items.map(rowHtml).join('');
  }
  updateMenuSortIndicators();
}
$('#menuSearch').addEventListener('input', renderMenuTable);
$('#menuCatFilter').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  adminMenuCategory = chip.dataset.cat;
  renderMenuCatFilter();
  renderMenuTable();
});
$('#menuGroupToggle').addEventListener('change', (e) => {
  menuGroupBy = e.target.checked;
  renderMenuTable();
});
$('#menuTable').querySelector('thead').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const key = th.dataset.sort;
  if (menuSort.key === key) menuSort.dir = (menuSort.dir === 'asc') ? 'desc' : 'asc';
  else { menuSort.key = key; menuSort.dir = 'asc'; }
  renderMenuTable();
});
$('#addCategoryBtn').addEventListener('click', () => {
  const label = (prompt('New category name (e.g. Smoothies, Sandwiches):') || '').trim();
  if (!label) return;
  const { category, created } = Store.addCategory(label);
  if (!category) return;
  CONFIG = Store.getConfig();
  renderCategoryChips();
  renderMenuCatFilter();
  showAdminToast({
    title: created ? `Category "${category.label}" added` : `Category "${category.label}" already exists`,
    variant: created ? 'success' : 'info',
  });
});

/* ----- Admin multi-select delete (menu) ----- */
let menuSelectMode = false;
const selectedMenu = new Set();
$('#menuSelectToggle').addEventListener('click', () => {
  menuSelectMode = !menuSelectMode;
  selectedMenu.clear();
  $('#menuSelectToggle').textContent = menuSelectMode ? 'Cancel select' : 'Select';
  $('#deleteSelectedMenuBtn').hidden = !menuSelectMode;
  $('#deleteSelectedMenuBtn').textContent = 'Delete selected';
  renderMenuTable();
});
$('#menuTableBody').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-menu-select]');
  if (!cb) return;
  if (cb.checked) selectedMenu.add(cb.dataset.menuSelect);
  else            selectedMenu.delete(cb.dataset.menuSelect);
  $('#deleteSelectedMenuBtn').textContent = selectedMenu.size
    ? `Delete selected (${selectedMenu.size})` : 'Delete selected';
});
$('#deleteSelectedMenuBtn').addEventListener('click', () => {
  if (!selectedMenu.size) { showAdminToast({ title: 'No items selected', variant: 'info' }); return; }
  if (!confirm(`Delete ${selectedMenu.size} selected item${selectedMenu.size === 1 ? '' : 's'}?`)) return;
  const n = selectedMenu.size;
  selectedMenu.forEach(id => Store.deleteMenuItemLogged(id));
  selectedMenu.clear();
  menuSelectMode = false;
  $('#menuSelectToggle').textContent = 'Select';
  $('#deleteSelectedMenuBtn').hidden = true;
  $('#deleteSelectedMenuBtn').textContent = 'Delete selected';
  MENU = Store.getMenu();
  renderMenuTable();
  renderMenu();
  showAdminToast({ title: `Deleted ${n} item${n === 1 ? '' : 's'}`, variant: 'danger' });
  refreshAdminActivity();
});
$('#menuTableBody').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'edit') {
    const it = Store.getMenu().find(m => m.id === id);
    if (it) openItemModal(it);
  }
  if (btn.dataset.act === 'delete') {
    const item = Store.getMenu().find(m => m.id === id);
    if (!item) return;
    if (!confirm(`Delete "${item.name}"?`)) return;
    Store.deleteMenuItemLogged(id);
    MENU = Store.getMenu();
    renderMenuTable();
    renderMenu();
    // Undo path: restores the deleted item exactly as it was.
    showAdminToast({
      title:   `Deleted "${item.name}"`,
      variant: 'danger',
      undo:    () => {
        Store.upsertMenuItemLogged(item);
        MENU = Store.getMenu();
        renderMenuTable();
        renderMenu();
        showAdminToast({ title: `Restored "${item.name}"`, variant: 'success' });
        refreshAdminActivity();
      },
    });
    refreshAdminActivity();
  }
});
$('#addMenuItemBtn').addEventListener('click', () => openItemModal(null));

/* ----- Item edit modal ----- */
let editingItemId = null;

/* Slugify a name into a menu-item id, and guarantee uniqueness so a
   blank ID field can be auto-filled (the ID is no longer a manual
   requirement — admins just type the name). */
function slugifyId(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function uniqueItemId(base) {
  const menu = Store.getMenu();
  const root = base || ('item-' + Date.now());
  if (!menu.some(m => m.id === root)) return root;
  let n = 2;
  while (menu.some(m => m.id === `${root}-${n}`)) n++;
  return `${root}-${n}`;
}

/* Populate the item modal's category <select> from the data-driven
   list, plus a trailing "+ New category…" sentinel option. */
const NEW_CATEGORY_SENTINEL = '__new__';
function fillItemCategorySelect(selectedId) {
  const sel = $('#itemCategorySelect');
  if (!sel) return;
  const cats = Store.getCategories();
  sel.innerHTML =
    cats.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join('') +
    `<option value="${NEW_CATEGORY_SENTINEL}">➕ New category…</option>`;
  const fallback = cats[0] ? cats[0].id : '';
  sel.value = (selectedId && cats.some(c => c.id === selectedId)) ? selectedId : fallback;
  sel.dataset.prev = sel.value;            // remembered so we can revert a cancelled "+ New"
}

/* Render the "Options the customer can choose" toggles from the
   unified option-def list (built-ins + custom groups) so admins can
   enable any group, not just size/temp/milk/sugar. */
function renderItemOptionChecks(selected = {}) {
  const host = $('#itemOptionsChecks');
  if (!host) return;
  host.innerHTML = optionDefs().map(def =>
    `<label><input type="checkbox" data-opt-key="${escapeHtml(def.key)}"${selected[def.key] ? ' checked' : ''} /> ${escapeHtml(def.label)}</label>`
  ).join('');
}

function openItemModal(item) {
  editingItemId = item?.id || null;
  $('#itemModalTitle').textContent = item ? 'Edit item' : 'Add item';
  $('#itemFormError').hidden = true;
  const f = $('#itemForm');
  f.reset();
  fillItemCategorySelect(item ? item.category : null);
  renderItemOptionChecks(item ? (item.options || {}) : {});
  if (item) {
    f.id.value       = item.id;       f.id.disabled = true;
    f.name.value     = item.name;
    f.price.value    = item.price;
    f.emoji.value    = item.emoji || '';
    f.tag.value      = item.tag   || '';
    f.desc.value     = item.desc  || '';
    f.img.value      = item.img   || '';
  } else {
    f.id.disabled = false;
    f.emoji.value = '☕';
  }
  openModal('#itemModal');
}
function closeItemModal() { closeModal('#itemModal'); editingItemId = null; }
$('#closeItemModalBtn').addEventListener('click', closeItemModal);
$('#cancelItemBtn').addEventListener('click', closeItemModal);

/* "+ New category…" in the item-modal select: prompt for a name,
   add it to the data-driven list, then re-select it (and refresh
   the customer chips + admin filter so it shows everywhere). */
$('#itemCategorySelect').addEventListener('change', (e) => {
  const sel = e.target;
  if (sel.value !== NEW_CATEGORY_SENTINEL) { sel.dataset.prev = sel.value; return; }
  const label = (prompt('New category name (e.g. Smoothies, Sandwiches):') || '').trim();
  if (!label) { sel.value = sel.dataset.prev || ''; return; }   // cancelled — revert
  const { category, created } = Store.addCategory(label);
  if (!category) { sel.value = sel.dataset.prev || ''; return; }
  CONFIG = Store.getConfig();
  fillItemCategorySelect(category.id);     // rebuild options + select the new/existing one
  renderCategoryChips();                   // customer-facing chips
  if (!adminPanel.hidden) renderMenuCatFilter();
  showAdminToast({
    title: created ? `Category "${category.label}" added` : `Category "${category.label}" already exists`,
    variant: created ? 'success' : 'info',
  });
});

$('#itemForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f  = $('#itemForm');
  // ID is now auto-generated from the name when left blank. An admin
  // can still type one to override; editing keeps the existing id.
  let id = f.id.value.trim().toLowerCase();
  if (!id) {
    id = editingItemId || uniqueItemId(slugifyId(f.name.value));
  }
  if (!id) return;
  const existing = Store.getMenu().find(m => m.id === id);
  if (existing && existing.id !== editingItemId) {
    $('#itemFormError').textContent = `ID "${id}" already exists`;
    $('#itemFormError').hidden = false;
    return;
  }
  // Read enabled option groups (built-in + custom) from the dynamic
  // checkboxes. Store true only for the checked ones.
  const options = {};
  $$('#itemOptionsChecks input[type="checkbox"]').forEach(cb => {
    if (cb.checked) options[cb.dataset.optKey] = true;
  });
  const item = {
    id,
    name:     f.name.value.trim(),
    category: f.category.value,
    price:    Number(f.price.value),
    emoji:    f.emoji.value || '☕',
    desc:     f.desc.value.trim(),
    tag:      f.tag.value.trim() || undefined,
    img:      f.img.value || '',
    options,
  };
  const wasEdit = !!editingItemId;
  Store.upsertMenuItemLogged(item);
  MENU = Store.getMenu();
  closeItemModal();
  renderMenuTable();
  renderMenu();
  showAdminToast({
    title:   wasEdit ? `Saved "${item.name}"` : `Added "${item.name}"`,
    variant: 'success',
  });
  refreshAdminActivity();
});

/* ----- Add option group modal -----
   Lets an admin define a brand-new customer option group (label +
   choices with price deltas), so item options aren't limited to the
   four built-ins. Opened from the "+ Add option" button in the item
   modal; on save the new group is added to config and immediately
   selectable as a checkbox in the item modal. */
function addOptionChoiceRow(label = '', delta = '') {
  const host = $('#optionChoiceRows');
  const row = document.createElement('div');
  row.className = 'opt-choice-row';
  row.innerHTML = `
    <input type="text" class="opt-choice-label" placeholder="Choice (e.g. Pearls)" value="${escapeHtml(label)}" />
    <input type="number" class="opt-choice-delta" step="1" placeholder="+0" value="${delta === '' ? '' : Number(delta)}" aria-label="Extra price" />
    <button type="button" class="icon-btn opt-choice-remove" aria-label="Remove choice">✕</button>`;
  host.appendChild(row);
}
function openOptionGroupModal() {
  const f = $('#optionGroupForm');
  f.reset();
  $('#optionGroupError').hidden = true;
  $('#optionChoiceRows').innerHTML = '';
  addOptionChoiceRow();          // start with a couple of blank rows
  addOptionChoiceRow();
  openModal('#optionGroupModal');
  setTimeout(() => f.elements.label?.focus(), 50);
}
function closeOptionGroupModal() { closeModal('#optionGroupModal'); }
$('#addOptionGroupBtn').addEventListener('click', openOptionGroupModal);
$('#closeOptionGroupBtn').addEventListener('click', closeOptionGroupModal);
$('#cancelOptionGroupBtn').addEventListener('click', closeOptionGroupModal);
$('#addChoiceRowBtn').addEventListener('click', () => addOptionChoiceRow());
$('#optionChoiceRows').addEventListener('click', (e) => {
  const rm = e.target.closest('.opt-choice-remove');
  if (rm) rm.closest('.opt-choice-row').remove();
});
$('#optionGroupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('#optionGroupError');
  err.hidden = true;
  const label = $('#optionGroupForm').elements.label.value.trim();
  const choices = $$('#optionChoiceRows .opt-choice-row').map(r => ({
    label: r.querySelector('.opt-choice-label').value,
    delta: r.querySelector('.opt-choice-delta').value,
  })).filter(c => c.label.trim());
  if (!label)            { err.textContent = 'Give the option group a name.';     err.hidden = false; return; }
  if (!choices.length)   { err.textContent = 'Add at least one choice.';          err.hidden = false; return; }
  const { group, created } = Store.addOptionGroup(label, choices);
  if (!group) { err.textContent = 'Could not add that group.'; err.hidden = false; return; }
  CONFIG = Store.getConfig();
  // Re-render the item modal's option toggles, keeping what's already
  // checked and enabling the new group by default.
  const selected = {};
  $$('#itemOptionsChecks input[type="checkbox"]').forEach(cb => { if (cb.checked) selected[cb.dataset.optKey] = true; });
  if (created) selected[group.id] = true;
  renderItemOptionChecks(selected);
  closeOptionGroupModal();
  showAdminToast({
    title: created ? `Option "${group.label}" added` : `Option "${group.label}" already exists`,
    variant: created ? 'success' : 'info',
  });
});
bindBackdropClose('#optionGroupModal', closeOptionGroupModal);

/* ----- Settings panel ----- */
function loadSettingsForm() {
  const cfg = Store.getConfig();
  const f = $('#settingsForm');
  Object.entries(cfg).forEach(([k, v]) => {
    const el = f.elements[k];
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else                        el.value   = v;
  });
  refreshInviteCodeView();
}

function refreshInviteCodeView() {
  const el = $('#inviteCodeView');
  if (el) el.textContent = Store.getInviteCode();
}

$('#copyInviteBtn')?.addEventListener('click', async () => {
  const code = Store.getInviteCode();
  try {
    await navigator.clipboard.writeText(code);
    showAdminToast({ title: 'Invite code copied', variant: 'success' });
  } catch {
    // Clipboard API can fail on http:// — fall back to selection.
    const sel = window.getSelection(), r = document.createRange();
    r.selectNodeContents($('#inviteCodeView')); sel.removeAllRanges(); sel.addRange(r);
    showAdminToast({ title: 'Selected — press Ctrl+C', variant: 'info' });
  }
});
$('#rotateInviteBtn')?.addEventListener('click', () => {
  if (!confirm('Rotate the invite code? Any pending invite links using the old code will stop working.')) return;
  Store.rotateInviteCode();
  refreshInviteCodeView();
  showAdminToast({ title: 'New invite code generated', variant: 'success' });
});

/* Admin-only path to create another staff account from inside
   the panel. Skips the invite code check because the caller is
   already authenticated as admin. */
$('#openAddStaffBtn')?.addEventListener('click', () => {
  $('#addStaffError').hidden = true;
  $('#addStaffForm').reset();
  openModal('#addStaffModal');
});
$('#closeAddStaffBtn')?.addEventListener('click', () => closeModal('#addStaffModal'));
bindBackdropClose('#addStaffModal', () => closeModal('#addStaffModal'));

$('#addStaffForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#addStaffError');
  err.hidden = true;
  const fd = new FormData(e.target);
  try {
    const account = await Store.registerAccount({
      name:            fd.get('name'),
      email:           fd.get('email'),
      password:        fd.get('password'),
      role:            'admin',
      skipInviteCheck: true,
    });
    closeModal('#addStaffModal');
    showAdminToast({ title: `Added ${account.name}`, variant: 'success' });
  } catch (ex) {
    err.textContent = ex.message || String(ex);
    err.hidden = false;
  }
});
$('#saveSettingsBtn').addEventListener('click', () => {
  const f = $('#settingsForm');
  const fd = new FormData(f);
  const patch = {};
  for (const [k, v] of fd.entries()) {
    patch[k] = (k === 'tables' || k === 'taxRate') ? Number(v) : v;
  }
  // Checkboxes only appear in FormData when checked, so we read
  // them directly to capture the off state too.
  patch.taxInclusive = f.elements.taxInclusive?.checked || false;
  Store.setConfig(patch);
  CONFIG = Store.getConfig();
  applyConfigToDOM();
  showAdminToast({ title: 'Settings saved', variant: 'success' });
});

/* Dump the live store back to the same JSON shape the seed
   files use. Drop these into data/ to update the cold-start
   seed, or feed them into a real backend (mongoimport,
   MySQL JSON_TABLE, etc.). */
$('#exportAccountsBtn').addEventListener('click', async () => {
  const users = await Store.getUsers();
  triggerDownload('accounts.json', JSON.stringify(users, null, 2), 'application/json');
  showAdminToast({ title: `Exported ${users.length} account${users.length === 1 ? '' : 's'}`, variant: 'success' });
});
$('#exportProductsBtn').addEventListener('click', () => {
  const menu = Store.getMenu();
  triggerDownload('products.json', JSON.stringify(menu, null, 2), 'application/json');
  showAdminToast({ title: `Exported ${menu.length} products`, variant: 'success' });
});

$('#resetMenuBtn').addEventListener('click', () => {
  if (!confirm('Reset menu to defaults? Custom items will be lost.')) return;
  Store.resetMenu();
  MENU = Store.getMenu();
  renderMenuTable();
  renderMenu();
  showToast('Menu reset');
});
$('#factoryResetBtn').addEventListener('click', () => {
  if (!confirm('Factory reset wipes everything (menu, orders, settings, sign-in). Continue?')) return;
  Store.factoryReset();
  showToast('Reset complete');
  setTimeout(() => location.reload(), 600);
});
$('#resetEverythingBtn').addEventListener('click', async () => {
  if (!confirm('Reset EVERYTHING to default? This clears all orders, chat, activity, sessions, accounts, menu and settings on the cloud AND this device. This affects every device and cannot be undone.')) return;
  // Type-to-confirm for a destructive, cross-device wipe.
  const typed = prompt('Type RESET to confirm the full wipe:');
  if ((typed || '').trim().toUpperCase() !== 'RESET') { showAdminToast({ title: 'Reset cancelled', variant: 'info' }); return; }
  const btn = $('#resetEverythingBtn');
  btn.disabled = true;
  btn.textContent = 'Resetting…';
  try {
    await Store.resetEverything();
    showToast('Everything reset — reloading');
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Reset everything';
    showAdminToast({ title: 'Reset failed — see console', variant: 'danger' });
    console.error('[reset] failed', e);
  }
});

/* ==========================================================
   ADMIN SLIDE-IN TOASTS  (separate stack from the customer
   #toast so admins see action confirmations bottom-right and
   customers see info-toasts bottom-center; never collide).
   Each toast: title, optional variant, optional Undo button.
   Auto-dismiss after 6s unless Undo is clicked.
   ========================================================== */
function showAdminToast({ title, variant = 'info', undo = null, ttl = 6000 }) {
  if (adminPanel.hidden) return;          // don't show admin toasts to customers
  const stack = $('#adminToastStack');
  const el = document.createElement('div');
  el.className = `admin-toast variant-${variant}`;
  el.innerHTML = `
    <div class="admin-toast-body">${escapeHtml(title)}</div>
    <div class="admin-toast-actions"></div>
  `;
  const actions = el.querySelector('.admin-toast-actions');
  if (undo) {
    const undoBtn = document.createElement('button');
    undoBtn.className = 'admin-toast-undo';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', () => {
      try { undo(); } finally { dismiss(); }
    });
    actions.appendChild(undoBtn);
  }
  const closeBtn = document.createElement('button');
  closeBtn.className = 'admin-toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => dismiss());
  actions.appendChild(closeBtn);

  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const timer = setTimeout(dismiss, ttl);
  function dismiss() {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }
}

/* ==========================================================
   ADMIN ACTIVITY BELL  (dropdown + unseen badge)
   The badge counts entries newer than the last id the admin
   has acknowledged by opening the dropdown.
   ========================================================== */
const LOG_ICON = {
  order_placed:  '🧾',
  order_status:  '✕',   // only fired for customer-initiated cancels now
  menu_delete:   '🗑',
};

function refreshAdminActivity() {
  // Bell badge
  const unseen = Store.getUnseenLogCount();
  const badge  = $('#bellBadge');
  badge.hidden = unseen === 0;
  badge.textContent = unseen > 99 ? '99+' : unseen;

  // If the dropdown is open, re-render its body too so new
  // entries appear live.
  if (!$('#bellDropdown').hidden) renderBellList();
}

function renderBellList() {
  const log  = Store.getLog();
  const host = $('#bellList');
  if (log.length === 0) {
    host.innerHTML = `<p class="empty-state">No activity yet.</p>`;
    return;
  }
  host.innerHTML = log.map(e => {
    const jumpable = !!e.orderId;
    return `
      <div class="bell-row ${jumpable ? 'jumpable' : ''}"
           data-type="${e.type}"
           data-log-id="${e.id}"
           ${jumpable ? `data-jump-order="${e.orderId}"` : ''}>
        <span class="bell-row-icon" aria-hidden="true">${LOG_ICON[e.type] || '•'}</span>
        <div class="bell-row-body">
          <div>${escapeHtml(e.message)}</div>
          <small class="muted">${timeAgo(new Date(e.ts))}</small>
        </div>
      </div>
    `;
  }).join('');
}

/* Click a notification → switch to Orders, scroll the matching
   card into view, flash it briefly. Non-order entries (menu
   deletes) silently close the dropdown. */
$('#bellList').addEventListener('click', (e) => {
  const row = e.target.closest('.bell-row');
  if (!row) return;
  const orderId = row.dataset.jumpOrder;
  $('#bellDropdown').hidden = true;
  if (!orderId) return;

  // The order may have been cleared/deleted since the notification
  // was logged — there's nothing to jump to.
  if (!Store.getOrders().some(o => o.id === orderId)) {
    showAdminToast({ title: 'That order is no longer in the list', variant: 'info' });
    return;
  }

  switchAdminTab('orders');   // renders the orders list synchronously
  // If the active filter (e.g. "Pending only") hides this order,
  // widen to "All" so the notification can always reach its target
  // — otherwise the card isn't in the DOM and the jump silently
  // does nothing.
  if (!$(`.order-card[data-id="${orderId}"]`)) {
    $('#orderFilter').value = 'all';
    renderOrders();
  }
  // Wait one frame so the (possibly re-rendered) DOM is laid out
  // before we scroll + flash.
  requestAnimationFrame(() => flashOrderCard(orderId));
});

function flashOrderCard(orderId) {
  const card = $(`.order-card[data-id="${orderId}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('flash');     // restart animation if mid-flash
  void card.offsetWidth;              // force reflow
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 2400);
}

function toggleBellDropdown() {
  const dd = $('#bellDropdown');
  const willOpen = dd.hidden;
  dd.hidden = !willOpen;
  if (willOpen) {
    renderBellList();
    const log = Store.getLog();
    if (log[0]) Store.markLogSeen(log[0].id);
    refreshAdminActivity();
  }
}
$('#bellBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleBellDropdown();
});
$('#clearLogBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!confirm('Clear activity log?')) return;
  Store.clearLog();
  refreshAdminActivity();
  renderBellList();
});
/* Click anywhere outside the bell to close it. */
document.addEventListener('click', (e) => {
  const dd = $('#bellDropdown');
  if (dd.hidden) return;
  if (e.target.closest('.bell-wrap')) return;
  dd.hidden = true;
});

/* Background sync — pick up new activity entries from order
   placements happening in other tabs / customer devices. Only
   runs while admin panel is open. */
setInterval(() => {
  if (adminPanel.hidden) return;
  refreshAdminActivity();
}, 4000);

/* ==========================================================
   TAX MATH  (shared between receipts and the CSV exporter)
   - taxInclusive: order.total already includes VAT. Tax is the
     embedded portion; subtotal is total minus tax.
   - taxExclusive: order.total is pre-tax. Tax is added on top,
     reported grand total = order.total + tax.
   ========================================================== */
function taxBreakdown(orderTotal) {
  const rate = Number(CONFIG.taxRate || 0) / 100;
  if (CONFIG.taxInclusive) {
    const subtotal = rate > 0 ? orderTotal / (1 + rate) : orderTotal;
    const tax      = orderTotal - subtotal;
    return { subtotal, tax, grand: orderTotal };
  }
  const tax   = orderTotal * rate;
  const grand = orderTotal + tax;
  return { subtotal: orderTotal, tax, grand };
}

/* ==========================================================
   RECEIPT MODAL  (admin)
   Renders a printable receipt preview. The "Send to printer
   (API)" button is a stub — wire it to a real receipt printer
   (ESC/POS over network/Bluetooth, vendor SDK, etc.).
   ========================================================== */
function openReceiptModal(order) {
  const html = buildReceiptHtml(order);
  $('#receiptPreview').innerHTML = html;
  $('#sendReceiptBtn').dataset.orderId      = order.id;
  $('#downloadReceiptBtn').dataset.orderId  = order.id;
  $('#printReceiptBtn').dataset.orderId     = order.id;
  openModal('#receiptModal');
}
function closeReceiptModal() { closeModal('#receiptModal'); }
$('#closeReceiptBtn').addEventListener('click', closeReceiptModal);
bindBackdropClose('#receiptModal', closeReceiptModal);

function buildReceiptHtml(order) {
  const { subtotal, tax, grand } = taxBreakdown(order.total);
  const taxLabel = escapeHtml(CONFIG.taxLabel || 'Tax');
  const taxRate  = Number(CONFIG.taxRate || 0);
  const placed   = new Date(order.placedAt);
  const served   = order.servedAt ? new Date(order.servedAt) : null;
  const lines = order.items.map(i => `
    <div class="rec-line">
      <span class="rec-line-name">${i.qty} × ${escapeHtml(i.name)}${i.summary ? `<small>${escapeHtml(i.summary)}</small>` : ''}</span>
      <span class="rec-line-price">${peso(i.unitPrice * i.qty)}</span>
    </div>
  `).join('');
  return `
    <div class="receipt" id="receiptPrintable">
      <header>
        <strong>${escapeHtml(CONFIG.businessName || CONFIG.shopName)}</strong>
        <small>${escapeHtml(CONFIG.businessAddr || '')}</small>
        ${CONFIG.businessTin ? `<small>TIN: ${escapeHtml(CONFIG.businessTin)}</small>` : ''}
      </header>
      <hr>
      <div class="rec-row"><span>Order</span><strong>#${order.number}</strong></div>
      <div class="rec-row"><span>Table</span><strong>${escapeHtml(String(order.tableNumber || '—'))}</strong></div>
      <div class="rec-row"><span>Placed</span><strong>${placed.toLocaleString()}</strong></div>
      ${served ? `<div class="rec-row"><span>Served</span><strong>${served.toLocaleString()}</strong></div>` : ''}
      <hr>
      ${lines}
      <hr>
      <div class="rec-row"><span>Subtotal</span><strong>${peso(subtotal)}</strong></div>
      <div class="rec-row"><span>${taxLabel} (${taxRate}%${CONFIG.taxInclusive ? ', incl.' : ''})</span><strong>${peso(tax)}</strong></div>
      <div class="rec-row total"><span>TOTAL</span><strong>${peso(grand)}</strong></div>
      <hr>
      <p class="rec-thanks">Thank you ☕</p>
    </div>
  `;
}

/* PLACEHOLDER — wire the actual receipt printer here. The
   `order` arg has everything you need: order.id, order.number,
   order.tableNumber, order.items (qty, name, unitPrice,
   summary), order.total, plus the taxBreakdown() result. */
async function sendReceiptToPrinter(order) {
  // TODO(receipt-api): replace this stub with the real call.
  // Example shape — adjust to whatever the printer expects:
  //
  //   await fetch('/api/printer/receipt', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({
  //       order,
  //       breakdown: taxBreakdown(order.total),
  //       shop: { name: CONFIG.businessName, addr: CONFIG.businessAddr, tin: CONFIG.businessTin },
  //     }),
  //   });
  console.warn('[receipt] no printer API wired — printing stub for order', order);
  await new Promise(r => setTimeout(r, 300));
}

$('#sendReceiptBtn').addEventListener('click', async () => {
  const id = $('#sendReceiptBtn').dataset.orderId;
  const o  = Store.getOrders().find(x => x.id === id);
  if (!o) return;
  try {
    await sendReceiptToPrinter(o);
    showAdminToast({ title: `Receipt #${o.number} sent`, variant: 'success' });
  } catch (err) {
    showAdminToast({ title: `Printer error: ${err.message || err}`, variant: 'danger' });
  }
});

$('#printReceiptBtn').addEventListener('click', () => {
  const id = $('#printReceiptBtn').dataset.orderId;
  const o  = Store.getOrders().find(x => x.id === id);
  if (!o) return;
  const win = window.open('', '_blank', 'width=380,height=600');
  if (!win) { showAdminToast({ title: 'Pop-up blocked', variant: 'danger' }); return; }
  win.document.write(`
    <html><head><title>Receipt #${o.number}</title>
    <style>
      body { font-family: ui-monospace, Menlo, Consolas, monospace; max-width: 320px; margin: 12px auto; }
      .receipt { font-size: 12px; line-height: 1.4; }
      .rec-row { display: flex; justify-content: space-between; }
      .rec-line { display: flex; justify-content: space-between; }
      .rec-line small { display: block; opacity: .65; }
      .total { font-size: 14px; font-weight: 700; }
      hr { border: none; border-top: 1px dashed #999; margin: 6px 0; }
      header { text-align: center; }
      header strong { display: block; font-size: 14px; }
      header small { display: block; opacity: .75; }
      .rec-thanks { text-align: center; margin: 6px 0 0; }
    </style></head><body>${buildReceiptHtml(o)}
    <script>window.onload = () => { window.print(); };<\/script>
    </body></html>
  `);
  win.document.close();
});

$('#downloadReceiptBtn').addEventListener('click', () => {
  const id = $('#downloadReceiptBtn').dataset.orderId;
  const o  = Store.getOrders().find(x => x.id === id);
  if (!o) return;
  const { subtotal, tax, grand } = taxBreakdown(o.total);
  const lines = [
    CONFIG.businessName || CONFIG.shopName,
    CONFIG.businessAddr || '',
    CONFIG.businessTin ? 'TIN: ' + CONFIG.businessTin : '',
    '-------------------------------',
    `Order #${o.number}`,
    `Table:  ${o.tableNumber || '-'}`,
    `Placed: ${new Date(o.placedAt).toLocaleString()}`,
    o.servedAt ? `Served: ${new Date(o.servedAt).toLocaleString()}` : '',
    '-------------------------------',
    ...o.items.map(i =>
      `${i.qty} x ${i.name}${i.summary ? ' — ' + i.summary : ''}  ${peso(i.unitPrice * i.qty)}`
    ),
    '-------------------------------',
    `Subtotal:  ${peso(subtotal)}`,
    `${CONFIG.taxLabel || 'Tax'} (${CONFIG.taxRate}%${CONFIG.taxInclusive ? ', incl.' : ''}):  ${peso(tax)}`,
    `TOTAL:     ${peso(grand)}`,
    '',
    'Thank you!',
  ].filter(Boolean).join('\n');
  triggerDownload(`receipt-${o.number}.txt`, lines, 'text/plain');
});

/* ==========================================================
   DAILY REPORT  (CSV exporter)
   - One row per order placed today.
   - Metadata block at the top uses real cells (not # comments)
     so Excel/Sheets reads them as a header table.
   - Totals row uses live SUM formulas referencing the data
     range so editing/removing rows in the spreadsheet keeps
     the totals correct.
   ========================================================== */
function buildDailyCsv() {
  const orders = Store.getOrders();
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const sameDay = (iso) => {
    if (!iso) return false;
    const t = new Date(iso);
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  };
  const todays = orders.filter(o => sameDay(o.placedAt));

  // Helper: spreadsheet-style ISO date format (Excel and Sheets
  // both auto-parse this as a date for sorting / filtering).
  const fmtDate = (iso) => {
    if (!iso) return '';
    const t = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
  };

  const headers = [
    'Order #', 'Table', 'Placed', 'Served', 'Status',
    'Items', 'Qty',
    'Subtotal', `${CONFIG.taxLabel || 'Tax'} (${CONFIG.taxRate}%)`, 'Total',
  ];

  const dataRows = todays.map(o => {
    const { subtotal, tax, grand } = taxBreakdown(o.total);
    const itemsSummary = o.items
      .map(i => `${i.qty}× ${i.name}${i.summary ? ' (' + i.summary + ')' : ''}`)
      .join('; ');
    const qtyTotal = o.items.reduce((s, i) => s + i.qty, 0);
    return [
      o.number,
      o.tableNumber || '',
      fmtDate(o.placedAt),
      fmtDate(o.servedAt),
      o.status,
      itemsSummary,
      qtyTotal,
      Number(subtotal.toFixed(2)),
      Number(tax.toFixed(2)),
      Number(grand.toFixed(2)),
    ];
  });

  // CSV escape — also wraps values that *look* like a formula
  // unless we explicitly want the formula behavior, so we'll
  // pass formulas through a sentinel object.
  const csvEscape = (v) => {
    if (v && typeof v === 'object' && v.__formula) return v.__formula;
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const formula = (f) => ({ __formula: f });

  const lines = [];

  // Metadata block — real cells so Excel parses them as a small
  // header table rather than dumping them into column A.
  lines.push([`${CONFIG.businessName || CONFIG.shopName} — Daily Report`].map(csvEscape).join(','));
  lines.push(['Generated',  fmtDate(now.toISOString())].map(csvEscape).join(','));
  lines.push(['Currency',   CONFIG.currency].map(csvEscape).join(','));
  lines.push(['Tax',        `${CONFIG.taxLabel} ${CONFIG.taxRate}% (${CONFIG.taxInclusive ? 'inclusive' : 'exclusive'})`].map(csvEscape).join(','));
  lines.push(['Orders today', todays.length].map(csvEscape).join(','));
  lines.push([`${(CONFIG.lifetimeOrders || 0).toLocaleString()} orders since opening!`].map(csvEscape).join(','));
  lines.push('');                              // blank spacer

  // Header row sits at this 1-based spreadsheet row number;
  // remember it so the formulas below can reference the data
  // range precisely (first data row = headerRow + 1).
  const headerRow = lines.length + 1;
  lines.push(headers.map(csvEscape).join(','));
  dataRows.forEach(r => lines.push(r.map(csvEscape).join(',')));

  // Total / formula footer. Two rows:
  //   - "ALL ORDERS" sums every row in the data range.
  //   - "SERVED ONLY" filters by status using SUMIF — so if the
  //     admin edits statuses inside the spreadsheet, totals
  //     update live.
  if (dataRows.length > 0) {
    const firstDataRow = headerRow + 1;
    const lastDataRow  = headerRow + dataRows.length;
    const colQty   = 'G';
    const colSub   = 'H';
    const colTax   = 'I';
    const colTotal = 'J';
    const colStatus = 'E';
    const rng = (col) => `${col}${firstDataRow}:${col}${lastDataRow}`;

    lines.push('');
    lines.push([
      '', '', '', '', 'ALL ORDERS', '',
      formula(`=SUM(${rng(colQty)})`),
      formula(`=SUM(${rng(colSub)})`),
      formula(`=SUM(${rng(colTax)})`),
      formula(`=SUM(${rng(colTotal)})`),
    ].map(csvEscape).join(','));
    lines.push([
      '', '', '', '', 'SERVED ONLY', '',
      formula(`=SUMIF(${rng(colStatus)},"served",${rng(colQty)})`),
      formula(`=SUMIF(${rng(colStatus)},"served",${rng(colSub)})`),
      formula(`=SUMIF(${rng(colStatus)},"served",${rng(colTax)})`),
      formula(`=SUMIF(${rng(colStatus)},"served",${rng(colTotal)})`),
    ].map(csvEscape).join(','));
  }

  const servedCount = todays.filter(o => o.status === 'served').length;
  // Prefix BOM so Excel detects UTF-8 (the ₱ / × glyphs render
  // correctly when double-clicked on Windows).
  return { csv: '﻿' + lines.join('\r\n'), todayCount: todays.length, servedCount };
}

function triggerDownload(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#exportCsvBtn').addEventListener('click', () => {
  const { csv, todayCount, servedCount } = buildDailyCsv();
  if (todayCount === 0) {
    showAdminToast({ title: 'No orders placed today yet', variant: 'info' });
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  triggerDownload(`bossb-daily-${stamp}.csv`, csv, 'text/csv');
  showAdminToast({
    title: `Exported ${todayCount} order${todayCount === 1 ? '' : 's'} (${servedCount} served)`,
    variant: 'success',
  });
});

/* ==========================================================
   REALTIME SYNC
   - The browser's `storage` event fires in OTHER tabs of the
     same origin whenever localStorage is written. We use it
     to make every tab feel live: a customer places an order
     in one tab, the admin panel in another tab refreshes
     immediately, no polling required.
   - Same-tab updates already re-render explicitly after each
     write; this layer is purely for cross-tab propagation.
   - Cross-DEVICE updates still rely on the existing polling
     intervals (true cross-device would need a backend); the
     intervals are tightened below to make that feel snappier.
   ========================================================== */
/* ---- Notification sound (sound/notif.wav) -------------------
   Played on the admin side when a new order arrives, and on the
   customer side when their order's status changes. Browsers block
   audio until the user has interacted with the page, so the clip
   is "unlocked" on the first pointer/key gesture and reused after
   (one decoded element, replayed by resetting currentTime). */
let notifAudio = null;
let notifAudioUnlocked = false;
function initNotifSound() {
  try {
    notifAudio = new Audio('sound/notif.wav');
    notifAudio.preload = 'auto';
  } catch (e) { return; }
  const unlock = () => {
    if (notifAudioUnlocked || !notifAudio) return;
    notifAudio.play().then(() => {
      notifAudio.pause();
      notifAudio.currentTime = 0;
      notifAudioUnlocked = true;
    }).catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
function playNotif() {
  if (!notifAudio) return;
  try { notifAudio.currentTime = 0; notifAudio.play().catch(() => {}); } catch (e) {}
}

const ORDER_STATUS_BY_ID = new Map();
function snapshotOrderStatuses() {
  ORDER_STATUS_BY_ID.clear();
  for (const o of Store.getOrders()) ORDER_STATUS_BY_ID.set(o.id, o.status);
}

/* Detects status changes for THIS customer's orders since the
   last snapshot and shows a friendly toast. Skipped silently
   when the admin panel is open (per the requested rule). */
function reactToCustomerOrderChanges() {
  const fresh = Store.getMyOrders();
  for (const o of fresh) {
    const prev = ORDER_STATUS_BY_ID.get(o.id);
    if (prev !== undefined && prev !== o.status) {
      const info = STATUS_INFO[o.status] || STATUS_INFO.pending;
      // Suppression hook: showToast already guards on admin
      // panel state, but we also skip the inline status-banner
      // animation noise so the admin view isn't visually
      // disrupted by something happening in the customer view
      // behind the panel.
      if (!adminPanelOpenForToasts()) {
        showToast(`${info.icon} Order #${o.number} — ${info.text}`, 'success');
      }
    }
    ORDER_STATUS_BY_ID.set(o.id, o.status);
  }
}

/* New-order detection for the admin side. Compares the current
   order list against the previous snapshot and fires a toast +
   subtle ping for any newcomers. Also re-renders the orders
   list if the admin panel is visible. */
let knownOrderIds = new Set();
function reactToAdminOrderChanges() {
  const all = Store.getOrders();
  const ids = new Set(all.map(o => o.id));
  const newcomers = all.filter(o => !knownOrderIds.has(o.id));
  // Only chime for orders THIS device didn't place itself.
  // (Otherwise an admin testing the customer flow gets a
  // duplicate "new order!" toast for the order they just placed.)
  const myId = Store.getClientId();
  for (const o of newcomers) {
    if (o.clientId === myId) continue;
    showAdminToast({
      title:   `🧾 New order #${o.number} · ${o.tableNumber || '—'}`,
      variant: 'info',
    });
  }
  knownOrderIds = ids;
  if (!adminPanel.hidden && $('.admin-tab.active').dataset.adminTab === 'orders') {
    renderOrders();
  }
  refreshAdminActivity();
  refreshOrdersBadge();
}

/* Cross-tab fan-out via the storage event. Only fires in OTHER
   tabs of the same origin, so it's the perfect signal that a
   write happened elsewhere. We respond by refreshing whichever
   surface (customer view, admin view, both) is currently shown
   in this tab. */
window.addEventListener('storage', (e) => {
  if (!e.key) return;
  if (e.key === 'bb_orders') {
    refreshOrderStatusBanner();
    refreshMyOrdersFab();
    if (!$('#myOrdersSheet').hidden) renderMyOrdersList();
    reactToCustomerOrderChanges();
    reactToAdminOrderChanges();
  } else if (e.key === 'bb_menu') {
    MENU = Store.getMenu();
    renderMenu();
    if (!adminPanel.hidden && $('.admin-tab.active').dataset.adminTab === 'menu') {
      renderMenuTable();
    }
  } else if (e.key === 'bb_config') {
    CONFIG = Store.getConfig();
    applyConfigToDOM();
    // Categories live in config — a new one added on another device
    // should appear in this tab's chips (and admin filter) too.
    renderCategoryChips();
    renderMenu();
    if (!adminPanel.hidden && $('.admin-tab.active')?.dataset.adminTab === 'menu') {
      renderMenuCatFilter();
      renderMenuTable();
    }
  } else if (e.key === 'bb_activity_log') {
    refreshAdminActivity();
  }
});

/* ==========================================================
   CHAT  (customer ↔ staff, per-table thread)
   ========================================================== */
const chatDrawer = $('#chatDrawer');
let chatThread = null;       // table label this drawer is showing
let chatRole   = 'customer'; // 'customer' | 'admin'
let chatMessages = [];
// Table labels with unread customer messages, for the admin's
// per-order chat-button dot (the customer dot lives on the FAB).
const adminUnreadThreads = new Set();

const CHAT_SEEN_KEY = 'bb_chat_seen';   // { [thread]: lastSeenTs }
function chatSeenMap() { try { return JSON.parse(localStorage.getItem(CHAT_SEEN_KEY) || '{}'); } catch { return {}; } }
function markChatSeen(thread) {
  const map = chatSeenMap();
  map[thread] = Date.now();
  localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(map));
}

async function openChat(thread, role = 'customer') {
  if (!thread) {                       // customer with no table yet
    showToast('Set your table first to chat', 'error');
    openTableModal();
    return;
  }
  // Customers can only chat once their table actually has an order —
  // no point messaging staff before ordering. (Admins always can.)
  if (role !== 'admin' && Store.getTableOrders(thread).length === 0) {
    showToast('Place an order first to chat with staff', 'error');
    return;
  }
  chatThread = thread;
  chatRole   = role;
  // Admin opened this table's thread → clear its unread dot.
  if (role === 'admin' && adminUnreadThreads.delete(String(thread))) {
    if (!adminPanel.hidden) renderOrders();
  }
  $('#chatTitle').textContent    = role === 'admin' ? `Table ${thread}` : 'Chat with staff';
  $('#chatSubtitle').textContent = role === 'admin' ? 'reply to this table' : 'ask about your order';
  chatDrawer.classList.add('open');
  chatDrawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('chat-open');
  $('#chatBody').innerHTML = `<p class="empty-state">Loading…</p>`;
  chatMessages = await Store.listMessages(thread);
  renderChatMessages();
  markChatSeen(thread);
  refreshChatDot();
}
function closeChat() {
  chatDrawer.classList.remove('open');
  chatDrawer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('chat-open');
  if (chatThread) markChatSeen(chatThread);
  refreshChatDot();
}
$('#closeChatBtn').addEventListener('click', closeChat);
$('#fabChatBtn').addEventListener('click', () => openChat(state.tableNumber, 'customer'));

function renderChatMessages() {
  const body = $('#chatBody');
  if (!chatMessages.length) {
    body.innerHTML = `<p class="empty-state">No messages yet. Say hi 👋</p>`;
    return;
  }
  body.innerHTML = chatMessages.map(m => {
    const mine = (chatRole === 'admin') ? (m.role === 'admin') : (m.role === 'customer' && m.sender === Store.getClientId());
    let inner;
    if (m.kind === 'image')      inner = `<img class="chat-img" src="${m.body}" alt="photo" />`;
    else if (m.kind === 'audio') inner = `<audio class="chat-audio" controls src="${m.body}"></audio>`;
    else                         inner = `<span>${escapeHtml(m.body)}</span>`;
    return `
      <div class="chat-msg ${mine ? 'mine' : 'theirs'}">
        ${(!mine) ? `<small class="chat-who">${escapeHtml(m.senderName || (m.role === 'admin' ? 'Staff' : 'Guest'))}</small>` : ''}
        <div class="chat-bubble chat-${m.kind}">${inner}</div>
        <small class="chat-time">${timeAgo(new Date(m.ts))}</small>
      </div>`;
  }).join('');
  body.scrollTop = body.scrollHeight;
}

async function sendChat(kind, body) {
  if (!chatThread) return;
  const text = (kind === 'text') ? (body || '').trim() : body;
  if (!text) return;
  try {
    const msg = await Store.sendMessage({
      thread: chatThread, role: chatRole, kind, body: text,
      senderName: chatRole === 'admin'
        ? (Store.getSession()?.name || 'Staff')
        : (state.tableNumber || 'Guest'),
    });
    // Optimistic echo: show the sender's own message immediately
    // if they're viewing the thread. In remote mode the realtime
    // INSERT also fires bb-chat with the same id; in local mode
    // sendMessage already dispatched it. Both are de-duped by id,
    // so this never double-renders.
    if (msg && chatThread === msg.thread && !chatMessages.some(m => m.id === msg.id)) {
      chatMessages.push(msg);
      renderChatMessages();
    }
  } catch (e) {
    showToast('Message failed to send', 'error');
  }
}

$('#chatSendBtn').addEventListener('click', () => {
  const inp = $('#chatInput');
  const v = inp.value.trim();
  if (!v) return;
  sendChat('text', v);
  inp.value = '';
  inp.focus();
});
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#chatSendBtn').click(); }
});

/* ----- Image: pick, compress, send ----- */
$('#chatImageBtn').addEventListener('click', () => $('#chatImageInput').click());
$('#chatImageInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const dataUrl = await compressImage(file, 1280, 0.7);
    // ~1.3x base64 overhead; cap a single image at ~1.5 MB encoded.
    if (dataUrl.length > 1.5 * 1024 * 1024) {
      showToast('Photo too large even after compression', 'error');
      return;
    }
    sendChat('image', dataUrl);
  } catch {
    showToast('Could not process that image', 'error');
  }
});
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim)      { height = Math.round(height * maxDim / width); width = maxDim; }
      else if (height > maxDim)                  { width = Math.round(width * maxDim / height); height = maxDim; }
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    const r = new FileReader();
    r.onload = () => { img.src = r.result; };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ----- Voice note: MediaRecorder ----- */
let mediaRecorder = null, recChunks = [], recTimer = null, recStart = 0;
$('#chatMicBtn').addEventListener('click', startRecording);
$('#chatRecStop').addEventListener('click', () => stopRecording(true));
$('#chatRecCancel').addEventListener('click', () => stopRecording(false));

async function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    showToast('Voice notes not supported on this device', 'error');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    recChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (!recordingKept) { recChunks = []; return; }
      const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const r = new FileReader();
      r.onload = () => {
        if (r.result.length > 3 * 1024 * 1024) { showToast('Voice note too long', 'error'); return; }
        sendChat('audio', r.result);
      };
      r.readAsDataURL(blob);
    };
    mediaRecorder.start();
    recStart = Date.now();
    $('#chatComposer').hidden = true;
    $('#chatRecording').hidden = false;
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      $('#chatRecTime').textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
      if (s >= 60) stopRecording(true);   // hard cap 60s
    }, 250);
  } catch {
    showToast('Microphone permission denied', 'error');
  }
}
let recordingKept = false;
function stopRecording(keep) {
  recordingKept = keep;
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
  $('#chatRecording').hidden = true;
  $('#chatComposer').hidden = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

/* ----- Realtime / cross-tab message arrival ----- */
window.addEventListener('bb-chat', (e) => {
  const msg = e.detail && e.detail.message;
  if (!msg) return;
  const viewingThisThread = chatThread && msg.thread === chatThread && chatDrawer.classList.contains('open');
  // Chime only for chat messages from the OTHER party that arrive
  // while you're NOT already reading that thread. Staff hear it for
  // customer messages; a customer hears it for staff replies on
  // their own table. (Order/activity events stay silent.)
  const iAmAdmin = Store.isAdmin();
  const fromOther = iAmAdmin
    ? msg.role === 'customer'
    : (msg.role === 'admin' && msg.thread === state.tableNumber);
  if (fromOther && !viewingThisThread) {
    playNotif();
    // Admin-side unread cue: light a dot on that table's order
    // card (the customer FAB dot is handled by refreshChatDot).
    if (iAmAdmin && msg.thread) {
      adminUnreadThreads.add(String(msg.thread));
      if (!adminPanel.hidden && $('.admin-tab.active')?.dataset.adminTab === 'orders') renderOrders();
    }
  }
  if (viewingThisThread) {
    if (!chatMessages.some(m => m.id === msg.id)) {
      chatMessages.push(msg);
      renderChatMessages();
      markChatSeen(chatThread);
    }
  } else {
    // Message for a thread we're not actively viewing → unread.
    refreshChatDot(msg);
  }
});
window.addEventListener('bb-chat-delete', (e) => {
  const id = e.detail && e.detail.id;
  if (!id) return;
  const before = chatMessages.length;
  chatMessages = chatMessages.filter(m => m.id !== id);
  if (chatMessages.length !== before) renderChatMessages();
});

/* Customer chat dot: lit when staff have sent a message to this
   table since the customer last opened the chat. */
function refreshChatDot(incoming) {
  const dot = $('#fabChatDot');
  if (!dot) return;
  if (chatRole === 'admin') { dot.hidden = true; return; }   // dot is customer-only
  const thread = state.tableNumber;
  if (!thread) { dot.hidden = true; return; }
  if (incoming && incoming.thread === thread && incoming.role === 'admin'
      && !(chatDrawer.classList.contains('open') && chatThread === thread)) {
    dot.hidden = false;
  }
}

/* ==========================================================
   THEME TOGGLE  (customer + admin both wired to the same fn)
   ========================================================== */
$('#themeToggleBtn').addEventListener('click', toggleTheme);
$('#adminThemeToggleBtn').addEventListener('click', toggleTheme);

/* ==========================================================
   HELPERS
   ========================================================== */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
/* Copy text to the clipboard with a legacy fallback for http:// /
   older browsers where navigator.clipboard is unavailable. */
async function copyTextToClipboard(text) {
  text = String(text || '');
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}
function timeAgo(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

/* ==========================================================
   BOOT
   ========================================================== */
async function boot() {
  initTheme();
  applyConfigToDOM();
  // Migration: an older build cached the table label here so
  // the customer wouldn't have to retype it after reload. We
  // now always re-prompt — clean the stale key on boot so it
  // doesn't accidentally pre-fill.
  localStorage.removeItem('bossb_table');
  await Store.bootSeed();

  // Always boot into the customer view. Admins click Staff
  // Login to enter the panel — they're never auto-redirected
  // on page load. Their session is still remembered so they
  // skip the form if they reopen the panel within the 8-hour
  // session window (handled in the Staff Login click handler).

  // If we arrived from register.html (or a deep link), open the
  // staff login form immediately. Don't auto-prompt for table.
  if (new URLSearchParams(location.search).get('staff') === '1') {
    openStaffLogin();
  } else {
    ensureTable();
  }
  renderCategoryChips();
  renderMenu();
  updateCart();
  refreshOrdersBadge();
  refreshAdminHeaderBtn();

  // Prepare the notification chime (unlocks on first gesture).
  initNotifSound();

  // Seed realtime baselines so the first poll/storage tick
  // doesn't fire stale "new order!" or "status changed" toasts
  // for orders that already existed when the tab opened.
  snapshotOrderStatuses();
  knownOrderIds = new Set(Store.getOrders().map(o => o.id));

  // Restore the customer's order state on reload — banner, FAB,
  // and polling all derive from the same client's orders.
  refreshOrderStatusBanner();
  refreshMyOrdersFab();
  // Always poll while the tab is open — even with zero orders
  // RIGHT NOW, a new one can arrive from another device. Cheap
  // (one localStorage read every 5s) and the storage event
  // also covers same-browser cross-tab updates instantly.
  if (!statusPollTimer) {
    statusPollTimer = setInterval(refreshOrderStatusBanner, 5000);
  }

  $('#year').textContent = new Date().getFullYear();
}

document.addEventListener('DOMContentLoaded', boot);
