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
}
function ensureTable() {
  let t = readTableFromURL();
  if (!t) t = (localStorage.getItem('bossb_table') || '').trim() || null;
  if (t) {
    setTableLabel(t);
    localStorage.setItem('bossb_table', t);
  } else {
    openTableModal();
  }
}
function openTableModal()  { openModal('#tableModal'); }
function closeTableModal() { closeModal('#tableModal'); }

/* Look for an in-flight order at this label from a *different*
   browser. If we find one, ask the customer to confirm before we
   commit to this label — otherwise two devices both claim
   "Window 2" and the staff get confused which order is whose. */
function checkDuplicateTable(label, onAccept) {
  const myId   = Store.getClientId();
  const others = Store.findActiveOrdersByTable(label).filter(o => o.clientId !== myId);
  if (others.length === 0) { onAccept(); return; }

  $('#dupTableLabel').textContent = label;
  $('#dupTableCount').textContent = others.length === 1 ? 'an' : `${others.length}`;
  pendingTableLabel = label;
  pendingTableAccept = onAccept;
  openModal('#dupTableModal');
}
let pendingTableLabel  = null;
let pendingTableAccept = null;

$('#dupTableJoinBtn').addEventListener('click', () => {
  const accept = pendingTableAccept;
  closeModal('#dupTableModal');
  pendingTableLabel = null; pendingTableAccept = null;
  if (accept) accept();
});
$('#dupTableElsewhereBtn').addEventListener('click', () => {
  closeModal('#dupTableModal');
  pendingTableLabel = null; pendingTableAccept = null;
  $('#tableInput').value = '';
  openTableModal();
});

$('#tableForm').addEventListener('submit', (e) => {
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
  checkDuplicateTable(label, () => {
    setTableLabel(label);
    localStorage.setItem('bossb_table', label);
    closeTableModal();
    bumpInactivity();
  });
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
  // logic always need a tick.
  refreshMyOrdersFab();
  maybeShowThanks();

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

  if (orders.length === 0) {
    host.innerHTML = `<p class="empty-state">No orders yet.</p>`;
    return;
  }
  host.innerHTML = orders.map(o => {
    const info  = STATUS_INFO[o.status] || STATUS_INFO.pending;
    const itemsHtml = o.items.map(i =>
      `<li>${i.qty}× ${escapeHtml(i.name)}</li>`
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
  const mine = Store.getMyOrders();
  if (mine.length === 0) return;
  const active = mine.filter(o => o.status === 'pending' || o.status === 'preparing').length;
  const anyServed = mine.some(o => o.status === 'served');
  if (active === 0 && anyServed && !thanksShown) {
    thanksShown = true;
    showThanksOverlay();
  }
}
function showThanksOverlay() {
  const ov = $('#thanksOverlay');
  ov.hidden = false;
  ov.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => ov.classList.add('open'));
  // Auto-reset table after 8s (customer can also dismiss to reset now)
  setTimeout(resetForNextCustomer, 8000);
}
function dismissThanks() {
  const ov = $('#thanksOverlay');
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
  setTimeout(() => { ov.hidden = true; }, 250);
}
function resetForNextCustomer() {
  // Forget this device's order history scope by clearing the
  // active-order pointer and the table label. Orders remain in
  // the store for the admin to clear/serve.
  clearActiveOrder();
  localStorage.removeItem('bossb_table');
  setTableLabel(null);
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
$('#thanksDismissBtn').addEventListener('click', resetForNextCustomer);

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
function closeStaffLogin() { closeModal('#staffLoginModal'); $('#staffLoginError').hidden = true; }
$('#openStaffLoginBtn').addEventListener('click', () => {
  // If a valid admin session is still cached, skip the login
  // form and drop them straight into the panel. Otherwise
  // show the login form.
  const session = Store.getSession();
  if (session && session.role === 'admin') enterAdminPanel(session);
  else                                      openStaffLogin();
});

/* Header Admin shortcut — visible only when a staff session
   is active. Click enters the admin panel directly. */
function refreshAdminHeaderBtn() {
  const session = Store.getSession();
  const isAdmin = !!session && session.role === 'admin';
  $('#adminTopbarBtn').hidden = !isAdmin;
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
  refreshAdminHeaderBtn();
  refreshAdminActivity();
}
function exitAdminPanel()  {
  adminPanel.hidden = true;
  refreshAdminHeaderBtn();
}
function adminSignOut() {
  Store.logout();
  exitAdminPanel();
  refreshAdminHeaderBtn();
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
          <h3>#${o.number}</h3>
          <span class="table-tag" title="Table">
            <span class="table-tag-label">Table</span>
            <strong>${tableLabel}</strong>
          </span>
          <span class="status-pill status-${o.status}">${o.status}</span>
          ${cancellable
            ? `<span class="cancellable-badge" title="Customer can still cancel">
                 ⏱ cancellable <span data-cancel-countdown="${o.id}">${secs}s</span>
               </span>`
            : ''}
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
    showAdminToast({ title: `${label} deleted`, variant: 'danger' });
  } else {
    Store.updateOrderStatus(id, act);
    showAdminToast({
      title: `${label} → ${act}`,
      variant: act === 'served' ? 'success' : act === 'cancelled' ? 'danger' : 'info',
    });
  }
  renderOrders();
  refreshAdminActivity();
});

/* Auto-refresh orders every 8s while the panel is open (so a
   second device's orders show up without a full reload). */
setInterval(() => {
  if (!adminPanel.hidden && $('.admin-tab.active').dataset.adminTab === 'orders') {
    renderOrders();
  }
}, 8000);

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
}
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
  switchAdminTab('orders');
  // renderOrders runs synchronously inside switchAdminTab; wait
  // one frame so the new DOM is laid out before we scroll.
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
   - One row per order placed today, with tax breakdown.
   - Summary row at the bottom (gross / net / tax).
   - "Today" = local-time calendar day.
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

  const headers = [
    'Order #', 'Table', 'Placed', 'Served', 'Status',
    'Items', 'Subtotal', `${CONFIG.taxLabel || 'Tax'} (${CONFIG.taxRate}%)`, 'Total',
  ];
  const rows = todays.map(o => {
    const { subtotal, tax, grand } = taxBreakdown(o.total);
    const itemsSummary = o.items
      .map(i => `${i.qty}x ${i.name}${i.summary ? ' (' + i.summary + ')' : ''}`)
      .join('; ');
    return [
      o.number,
      o.tableNumber || '',
      new Date(o.placedAt).toLocaleString(),
      o.servedAt ? new Date(o.servedAt).toLocaleString() : '',
      o.status,
      itemsSummary,
      subtotal.toFixed(2),
      tax.toFixed(2),
      grand.toFixed(2),
    ];
  });

  // Totals across served orders only — cancelled/pending don't
  // count toward "revenue collected today".
  const served = todays.filter(o => o.status === 'served');
  let sumSub = 0, sumTax = 0, sumGrand = 0;
  served.forEach(o => {
    const b = taxBreakdown(o.total);
    sumSub += b.subtotal; sumTax += b.tax; sumGrand += b.grand;
  });

  const csvEscape = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];
  lines.push(`# ${CONFIG.businessName || CONFIG.shopName} — Daily Report`);
  lines.push(`# Generated: ${now.toLocaleString()}`);
  lines.push(`# Currency: ${CONFIG.currency} · Tax: ${CONFIG.taxLabel} ${CONFIG.taxRate}% (${CONFIG.taxInclusive ? 'inclusive' : 'exclusive'})`);
  lines.push('');
  lines.push(headers.map(csvEscape).join(','));
  rows.forEach(r => lines.push(r.map(csvEscape).join(',')));
  lines.push('');
  lines.push(['', '', '', '', 'SERVED TOTALS', `${served.length} orders`,
              sumSub.toFixed(2), sumTax.toFixed(2), sumGrand.toFixed(2)].map(csvEscape).join(','));
  return { csv: lines.join('\n'), todayCount: todays.length, servedCount: served.length };
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
  refreshAdminHeaderBtn();

  // Restore the customer's order state on reload — banner, FAB,
  // and polling all derive from the same client's orders.
  refreshOrderStatusBanner();
  refreshMyOrdersFab();
  if (getMyActiveOrders().length > 0 && !statusPollTimer) {
    statusPollTimer = setInterval(refreshOrderStatusBanner, 5000);
  }

  $('#year').textContent = new Date().getFullYear();
}

document.addEventListener('DOMContentLoaded', boot);
