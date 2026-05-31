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
  toastEl.textContent = msg;
  toastEl.className   = 'toast show ' + variant;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
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
   TABLE NUMBER
   ========================================================== */
function readTableFromURL() {
  const params = new URLSearchParams(location.search);
  const t = params.get('table');
  return t ? parseInt(t, 10) || null : null;
}
function setTableNumber(n) {
  state.tableNumber = n;
  $('#tableNumberDisplay').textContent = n != null ? String(n) : '—';
}
function ensureTable() {
  let t = readTableFromURL();
  if (!t) t = parseInt(localStorage.getItem('bossb_table') || '0', 10) || null;
  if (t) {
    setTableNumber(t);
    localStorage.setItem('bossb_table', String(t));
  } else {
    openTableModal();
  }
}
function openTableModal()  { openModal('#tableModal'); }
function closeTableModal() { closeModal('#tableModal'); }
$('#tableForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = parseInt($('#tableInput').value, 10);
  if (!n || n < 1) return;
  setTableNumber(n);
  localStorage.setItem('bossb_table', String(n));
  closeTableModal();
});
$('#changeTableBtn').addEventListener('click', () => {
  $('#tableInput').value = state.tableNumber || '';
  openTableModal();
});

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

function openCart()  { cartDrawer.classList.add('open');    cartDrawer.setAttribute('aria-hidden', 'false'); }
function closeCart() { cartDrawer.classList.remove('open'); cartDrawer.setAttribute('aria-hidden', 'true');  }
$('#fabCartBtn').addEventListener('click', openCart);
$('#closeCartBtn').addEventListener('click', closeCart);

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
  const item = MENU.find(m => m.id === itemId);
  if (!item) return;
  const o = item.options || {};
  const canCustomize = o.size || o.temp || o.milk || o.sugar;

  if (!canCustomize && !opts.editLineKey) {
    addLine(item.id, defaultConfigFor(item), 1);
    showToast(`${item.name} added`, 'success');
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
$('#placeOrderBtn').addEventListener('click', () => {
  if (state.cart.length === 0) return;
  if (!state.tableNumber) {
    openTableModal();
    return;
  }
  // Build immutable line snapshot for the order record
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
  const order = Store.placeOrder({
    tableNumber: state.tableNumber,
    items,
  });
  clearCart();
  closeCart();
  // Show confirmation
  $('#placedOrderNumber').textContent = order.number;
  $('#placedTable').textContent       = `Table ${state.tableNumber}`;
  openModal('#orderPlacedModal');
  refreshOrdersBadge();
});

$('#newOrderBtn').addEventListener('click', () => closeModal('#orderPlacedModal'));

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
  if ($('#orderPlacedModal').classList.contains('open'))   return closeModal('#orderPlacedModal');
  if (cartDrawer.classList.contains('open'))               return closeCart();
});

/* ==========================================================
   STAFF LOGIN
   ========================================================== */
const staffLoginModal = $('#staffLoginModal');
function openStaffLogin()  { openModal('#staffLoginModal'); }
function closeStaffLogin() { closeModal('#staffLoginModal'); $('#staffLoginError').hidden = true; }
$('#openStaffLoginBtn').addEventListener('click', () => {
  // If a valid admin session is still cached, skip the login
  // form and drop them straight into the panel. Otherwise
  // show the login form.
  const session = Store.getSession();
  if (session && session.role === 'admin') enterAdminPanel(session);
  else                                      openStaffLogin();
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

function enterAdminPanel(session) {
  adminPanel.hidden = false;
  $('#adminUserName').textContent = session.name || session.email;
  switchAdminTab('orders');
  renderOrders();
  loadSettingsForm();
}
function exitAdminPanel()  { adminPanel.hidden = true; }
function adminSignOut() {
  Store.logout();
  exitAdminPanel();
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
    return `
      <article class="order-card" data-id="${o.id}">
        <header class="order-head">
          <h3>#${o.number}</h3>
          <span class="status-pill status-${o.status}">${o.status}</span>
        </header>
        <div class="order-meta">
          Table ${o.tableNumber ?? '—'} · placed ${placedAgo}
        </div>
        <ul>${itemsHtml}</ul>
        <div class="order-total">
          <span>Total</span>
          <span>${peso(o.total)}</span>
        </div>
        <div class="order-actions">
          ${o.status === 'pending'    ? `<button class="btn btn-primary" data-act="preparing">Mark preparing</button>` : ''}
          ${o.status === 'preparing'  ? `<button class="btn btn-primary" data-act="served">Mark served</button>`        : ''}
          ${o.status !== 'served' && o.status !== 'cancelled'
            ? `<button class="btn btn-ghost"  data-act="cancelled">Cancel</button>` : ''}
          <button class="btn btn-ghost" data-act="delete">Delete</button>
        </div>
      </article>
    `;
  }).join('');
  refreshOrdersBadge();
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
  if (act === 'delete') {
    if (!confirm('Delete this order?')) return;
    Store.deleteOrder(id);
  } else {
    Store.updateOrderStatus(id, act);
  }
  renderOrders();
});

/* Auto-refresh orders every 8s while the panel is open (so a
   second device's orders show up without a full reload). */
setInterval(() => {
  if (!adminPanel.hidden && $('.admin-tab.active').dataset.adminTab === 'orders') {
    renderOrders();
  }
}, 8000);

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
    if (!confirm(`Delete "${id}"?`)) return;
    Store.deleteMenuItem(id);
    MENU = Store.getMenu();
    renderMenuTable();
    renderMenu();
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
  Store.upsertMenuItem(item);
  MENU = Store.getMenu();
  closeItemModal();
  renderMenuTable();
  renderMenu();
  showToast(editingItemId ? 'Item updated' : 'Item added', 'success');
});

/* ----- Settings panel ----- */
function loadSettingsForm() {
  const cfg = Store.getConfig();
  const f = $('#settingsForm');
  Object.entries(cfg).forEach(([k, v]) => {
    if (f.elements[k]) f.elements[k].value = v;
  });
}
$('#saveSettingsBtn').addEventListener('click', () => {
  const fd = new FormData($('#settingsForm'));
  const patch = {};
  for (const [k, v] of fd.entries()) {
    patch[k] = (k === 'tables') ? Number(v) : v;
  }
  Store.setConfig(patch);
  CONFIG = Store.getConfig();
  applyConfigToDOM();
  showToast('Settings saved', 'success');
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
   THEME TOGGLE
   ========================================================== */
$('#themeToggleBtn').addEventListener('click', toggleTheme);

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
  await Store.seedIfEmpty();

  // Always boot into the customer view. Admins click Staff
  // Login to enter the panel — they're never auto-redirected
  // on page load. Their session is still remembered so they
  // skip the form if they reopen the panel within the 8-hour
  // session window (handled in the Staff Login click handler).

  ensureTable();
  renderMenu();
  updateCart();
  refreshOrdersBadge();
  $('#year').textContent = new Date().getFullYear();
}

document.addEventListener('DOMContentLoaded', boot);
