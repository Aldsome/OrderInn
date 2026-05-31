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
};

let MENU   = Store.getMenu();
let CONFIG = Store.getConfig();

/* ==========================================================
   FORMAT HELPERS
   ========================================================== */
const peso = (n) => `${CONFIG.currency}${Number(n).toFixed(2)}`;
const getOpt = (list, id) => list.find(o => o.id === id);

function defaultConfigFor(item) {
  const o = item.options || {};
  return {
    size:  o.size  ? (SIZES.find(s => s.default)?.id) : null,
    temp:  o.temp  ? (TEMPS.find(s => s.default)?.id) : (item.category === 'cold' ? 'ice' : null),
    milk:  o.milk  ? (MILKS.find(s => s.default)?.id) : null,
    sugar: o.sugar ? (SUGAR.find(s => s.default)?.id) : null,
    notes: '',
  };
}
function unitPrice(item, config) {
  let p = item.price;
  if (config.size)  p += getOpt(SIZES, config.size)?.delta  || 0;
  if (config.temp)  p += getOpt(TEMPS, config.temp)?.delta  || 0;
  if (config.milk)  p += getOpt(MILKS, config.milk)?.delta  || 0;
  if (config.sugar) p += getOpt(SUGAR, config.sugar)?.delta || 0;
  return p;
}
function lineKeyOf(itemId, config) {
  return [
    itemId,
    config.size || '_',
    config.temp || '_',
    config.milk || '_',
    config.sugar || '_',
    (config.notes || '').trim().toLowerCase(),
  ].join('|');
}
function configSummary(item, config) {
  const bits = [];
  if (config.size)  bits.push(getOpt(SIZES, config.size).label.split(/\s+/)[0]);
  if (config.temp)  bits.push(getOpt(TEMPS, config.temp).label);
  if (config.milk && config.milk !== 'regular') bits.push(getOpt(MILKS, config.milk).label);
  if (config.sugar) bits.push(`${getOpt(SUGAR, config.sugar).label} sugar`);
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
function openTableModal()  { openModal('#tableModal'); }
function closeTableModal() { closeModal('#tableModal'); }

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
  // Layer 1 — live session collision. First the LOCAL registry
  // (catches another tab of the same browser), then the REMOTE
  // registry via Supabase (catches another DEVICE holding the
  // same name before either has ordered — e.g. PC "art" + phone
  // "art"). This is a hard block: there's no "join" option for a
  // pure name clash, the second person must pick a different
  // label.
  let conflictId = Store.findActiveSessionByName(label);
  if (!conflictId) conflictId = await Store.findActiveSessionByNameRemote(label);
  if (conflictId) {
    showDupModal({ mode: 'nameTaken', label });
    return;
  }
  // Layer 2 — any active order at this label, from any device
  // (including this one). Orders sync through Supabase, so this
  // already works cross-device. Triggering on own-clientId too
  // lets a customer reopening the page see "you already have an
  // open order here — continue with it?" instead of silently
  // re-using the label.
  const matches = Store.findActiveOrdersByTable(label);
  if (matches.length === 0) { onAccept(); return; }

  const myId = Store.getClientId();
  // "Member" = this device already has an active order at this
  // label (the table owner, or someone who joined earlier on
  // this device). Members continue freely. Everyone else is a
  // would-be joiner and must pass the table PIN.
  const isMember = matches.some(o => o.clientId === myId);
  if (isMember) {
    showDupModal({ mode: 'ownOrder', label, count: matches.length, onAccept });
  } else {
    // The table's join PIN lives on its active orders (minted by
    // the first order). null = legacy orders placed before the
    // PIN feature existed → no gate (graceful degradation).
    const pin = matches.map(o => o.joinPin).find(Boolean) || null;
    showDupModal({ mode: 'share', label, count: matches.length, onAccept, pin });
  }
}
let pendingTableLabel  = null;
let pendingTableAccept = null;
let pendingTablePin    = null;   // expected PIN for the share-join gate
let pinAttempts        = 0;

/* Configure + open the duplicate/collision modal. Three modes:
   - 'nameTaken' : another live device holds this exact name —
                   only option is to choose a different label.
   - 'ownOrder'  : this device already has an open order here —
                   offer continue (join) or sit elsewhere.
   - 'share'     : someone else has an open order at this label —
                   offer join (table sharing) or sit elsewhere. */
function showDupModal({ mode, label, count = 1, onAccept = null, pin = null }) {
  const desc    = $('#dupTableDesc');
  const title   = $('#dupTableTitle');
  const joinBtn = $('#dupTableJoinBtn');
  const elseBtn = $('#dupTableElsewhereBtn');
  const pinRow  = $('#dupPinRow');
  $('#dupTableLabel').textContent = label;
  // Reset PIN UI each time.
  pendingTablePin = null;
  pinAttempts = 0;
  if (pinRow) pinRow.hidden = true;
  $('#dupPinError').hidden = true;
  $('#dupPinInput').value = '';

  if (mode === 'nameTaken') {
    if (title) title.textContent = 'That name is taken';
    if (desc) desc.textContent =
      `The name "${label}" is already in use on another device. Please choose a different name or number so staff don't mix up your orders.`;
    joinBtn.hidden = true;                       // no "join" for a name clash
    elseBtn.textContent = 'Choose another name';
    pendingTableAccept = null;                   // never auto-accept a clash
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
  if (mode === 'share' && pin) setTimeout(() => $('#dupPinInput').focus(), 50);
}

$('#dupTableJoinBtn').addEventListener('click', () => {
  // Share-join gate: if a PIN is expected, validate it first.
  if (pendingTablePin) {
    const entered = ($('#dupPinInput').value || '').trim();
    if (entered !== pendingTablePin) {
      pinAttempts++;
      const err = $('#dupPinError');
      err.textContent = pinAttempts >= 5
        ? 'Too many attempts. Please ask staff for help.'
        : 'Incorrect PIN. Ask the person who started this table.';
      err.hidden = false;
      const inp = $('#dupPinInput');
      inp.focus(); inp.select();
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
      setTableLabel(label);
      closeTableModal();
      bumpInactivity();
    });
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});
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

$$('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.category = chip.dataset.category;
    renderMenu();
  });
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
  const canCustomize = o.size || o.temp || o.milk || o.sugar;

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

$('#newOrderBtn').addEventListener('click', () => {
  closeModal('#orderPlacedModal');
  // "Start new order" = the customer is done with the last
  // order; clear it so the banner goes away.
  clearActiveOrder();
});
$('#closePlacedBtn').addEventListener('click', () => closeModal('#orderPlacedModal'));

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
function getActiveOrder() {
  // Prefer the explicitly-stored last-placed order so the banner
  // keeps tracking the same one until the customer dismisses it
  // (so "served" shows up briefly to remind them to pay). When
  // that one is gone, fall back to the most recent in-flight
  // order for this device.
  const id = localStorage.getItem('bossb_active_order');
  if (id) {
    const stored = Store.getOrders().find(o => o.id === id);
    if (stored) return stored;
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
  const pill = $('#placedStatusPill');
  pill.textContent = order.status;
  pill.className   = 'status-pill status-' + order.status;
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

function refreshMyOrdersFab() {
  const active = getMyActiveOrders().length;
  const fab = $('#fabMyOrdersBtn');
  fab.hidden = (active === 0);
  $('#fabMyOrdersBadge').textContent = active;
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
}
function closeMyOrders() {
  const sheet = $('#myOrdersSheet');
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  setTimeout(() => { sheet.hidden = true; }, 200);
  if (myOrdersTicker) { clearInterval(myOrdersTicker); myOrdersTicker = null; }
}
$('#fabMyOrdersBtn').addEventListener('click', openMyOrders);
$('#closeMyOrdersBtn').addEventListener('click', closeMyOrders);

function renderMyOrdersList() {
  const orders = Store.getMyOrders();
  const host   = $('#myOrdersList');
  const active = orders.filter(o => o.status === 'pending' || o.status === 'preparing').length;
  $('#myOrdersSummary').textContent = active === 0
    ? `${orders.length} total`
    : `${active} active · ${orders.length} total`;

  // Today's spending strip — sum of *non-cancelled* order totals
  // placed today. Cancelled orders shouldn't pad the customer's
  // "you spent" feeling.
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const todays = orders.filter(o => {
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
    ? `<div class="myorders-pin">
         <span>Table PIN</span>
         <strong>${escapeHtml(activePin)}</strong>
         <small>share with your table so they can add orders</small>
       </div>`
    : '';

  const orderRows = orders.map(o => {
    const info  = STATUS_INFO[o.status] || STATUS_INFO.pending;
    const itemsHtml = o.items.map(i =>
      `<li><span>${i.qty}× ${escapeHtml(i.name)}</span><span>${peso(i.unitPrice * i.qty)}</span></li>`
    ).join('');
    const cancellable = Store.isCancellableByCustomer(o);
    const secs = Math.ceil(Store.cancelWindowRemaining(o) / 1000);
    return `
      <article class="myorder-item" data-id="${o.id}" data-status="${o.status}">
        <header>
          <div>
            <strong>Order #${o.number}</strong>
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
            ? `<button class="btn btn-cancel-grace" data-act="cancel">
                 Cancel <span class="cancel-countdown">${secs}s</span>
               </button>`
            : ''}
        </footer>
      </article>
    `;
  }).join('');
  host.innerHTML = pinHtml + orderRows + ctaHtml;
}

$('#myOrdersList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.myorder-item');
  const id   = card.dataset.id;
  if (btn.dataset.act !== 'cancel') return;
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
  // 30-second safety auto-reset for the case where the customer
  // just walks away from the device. Both action buttons cancel
  // it explicitly.
  if (thanksAutoResetTimer) clearTimeout(thanksAutoResetTimer);
  thanksAutoResetTimer = setTimeout(resetForNextCustomer, 30000);
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
  clearActiveOrder();
  setTableLabel(null);
  Store.clearSessionTable();        // forget the 24h guest persistence
  clearCart();
  closeMyOrders();
  dismissThanks();
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
  if (tab === 'menu')     renderMenuTable();
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
      <article class="order-card" data-id="${o.id}" data-status="${o.status}">
        <header class="order-head">
          <div class="order-head-id">
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
          ${o.status === 'preparing'  ? `<button class="btn btn-serve"  data-act="served">Mark served</button>`        : ''}
          ${o.status !== 'served' && o.status !== 'cancelled'
            ? `<button class="btn btn-danger" data-act="cancelled">Cancel</button>` : ''}
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
  if (act === 'receipt') {
    if (order) openReceiptModal(order);
    return;
  }
  if (act === 'delete') {
    if (!confirm('Delete this order?')) return;
    Store.deleteOrder(id);
    knownOrderIds.delete(id);
    ORDER_STATUS_BY_ID.delete(id);
    showAdminToast({ title: `${label} deleted`, variant: 'danger' });
  } else {
    Store.updateOrderStatus(id, act);
    // Seed the snapshot with the new status so this same tab's
    // customer-side poll doesn't surface a status-change toast
    // to the admin themselves for an action they just took.
    ORDER_STATUS_BY_ID.set(id, act);
    showAdminToast({
      title: `${label} → ${act}`,
      variant: act === 'served' ? 'success' : act === 'cancelled' ? 'danger' : 'info',
    });
  }
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
function renderMenuTable() {
  const search = $('#menuSearch').value.trim().toLowerCase();
  const items = Store.getMenu().filter(it =>
    !search || `${it.name} ${it.category}`.toLowerCase().includes(search)
  );
  const body = $('#menuTableBody');
  if (items.length === 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--ink-soft)">No items.</td></tr>`;
    return;
  }
  body.innerHTML = items.map(it => `
    <tr data-id="${it.id}">
      <td><img class="thumb" src="${it.img || ''}" alt="" onerror="this.style.display='none'"></td>
      <td><strong>${escapeHtml(it.name)}</strong></td>
      <td>${it.category}</td>
      <td>${peso(it.price)}</td>
      <td>${it.tag ? `<span class="tag">${escapeHtml(it.tag)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="right">
        <div class="row-actions">
          <button class="btn btn-ghost"  data-act="edit"   data-id="${it.id}">Edit</button>
          <button class="btn btn-danger" data-act="delete" data-id="${it.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}
$('#menuSearch').addEventListener('input', renderMenuTable);
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
function openItemModal(item) {
  editingItemId = item?.id || null;
  $('#itemModalTitle').textContent = item ? 'Edit item' : 'Add item';
  $('#itemFormError').hidden = true;
  const f = $('#itemForm');
  f.reset();
  if (item) {
    f.id.value       = item.id;       f.id.disabled = true;
    f.name.value     = item.name;
    f.category.value = item.category;
    f.price.value    = item.price;
    f.emoji.value    = item.emoji || '';
    f.tag.value      = item.tag   || '';
    f.desc.value     = item.desc  || '';
    f.img.value      = item.img   || '';
    const o = item.options || {};
    f.opt_size.checked  = !!o.size;
    f.opt_temp.checked  = !!o.temp;
    f.opt_milk.checked  = !!o.milk;
    f.opt_sugar.checked = !!o.sugar;
  } else {
    f.id.disabled = false;
    f.emoji.value = '☕';
  }
  openModal('#itemModal');
}
function closeItemModal() { closeModal('#itemModal'); editingItemId = null; }
$('#closeItemModalBtn').addEventListener('click', closeItemModal);
$('#cancelItemBtn').addEventListener('click', closeItemModal);

$('#itemForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f  = $('#itemForm');
  const id = f.id.value.trim().toLowerCase();
  if (!id) return;
  const existing = Store.getMenu().find(m => m.id === id);
  if (existing && existing.id !== editingItemId) {
    $('#itemFormError').textContent = `ID "${id}" already exists`;
    $('#itemFormError').hidden = false;
    return;
  }
  const item = {
    id,
    name:     f.name.value.trim(),
    category: f.category.value,
    price:    Number(f.price.value),
    emoji:    f.emoji.value || '☕',
    desc:     f.desc.value.trim(),
    tag:      f.tag.value.trim() || undefined,
    img:      f.img.value || '',
    options: {
      size:  f.opt_size.checked,
      temp:  f.opt_temp.checked,
      milk:  f.opt_milk.checked,
      sugar: f.opt_sugar.checked,
    },
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
  } else if (e.key === 'bb_activity_log') {
    refreshAdminActivity();
  }
});

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
  renderMenu();
  updateCart();
  refreshOrdersBadge();
  refreshAdminHeaderBtn();

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
