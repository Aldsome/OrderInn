/* ==========================================================
   ORDERINN COFFEE — APP LOGIC
   Single-file SPA with two views in the same DOM:
   - Customer ordering (default)
   - Admin panel (overlays customer view when signed in)
   ========================================================== */



/* ==========================================================
   STATE
   ========================================================== */
const state = {
  cart:        [],
  category:    'all',
  tableNumber: null,        // repurposed: holds the SESSION ID (never shown)
  locationIdentifier: null, // optional checkout location note (from QR ?table=)
  editingLineKey: null,
  pendingQty:  1,
  editingOrderId: null,   // when set, placing the cart UPDATES this order
};


/* ==========================================================
   TABLE LABEL  (free-text — "Window seat", "Booth A", "5")
   ========================================================== */
function readTableFromURL() {
  const params = new URLSearchParams(location.search);
  const t = params.get('table');
  return t ? t.trim() : null;
}
/* ----- Session-based ordering (kiosk/QR model) -----
   The customer's ordering identity is a persistent per-device SESSION,
   not a table. For back-compat with the app's grouping/chat code,
   state.tableNumber holds the SESSION ID — it is never shown as a
   "table" and never typed by the user. An optional, free-text
   locationIdentifier (e.g. "Table 12", "Near window") may be set at
   checkout, and is auto-filled from a QR ?table= param if present.

   All the old table-picker machinery (table modal, name-collision
   checks, join-by-PIN, dup modal, move-on-rename, table strip) has
   been removed — there is no table to pick. */
function syncSession() {
  state.tableNumber = Store.getSessionId();   // session id (= device id)
  // No table name / PIN header UI in the session model.
  const nameEl = $('#tableNumberDisplay'); if (nameEl) nameEl.textContent = '';
  const pinEl  = $('#tablePinDisplay');    if (pinEl)  pinEl.hidden = true;
  if (typeof refreshOrderStatusBanner === 'function') refreshOrderStatusBanner();
  if (typeof refreshMyOrdersFab === 'function') refreshMyOrdersFab();
}
/* Back-compat shim: legacy callers used setTableLabel() to (re)bind the
   ordering identity; now it just re-syncs to the current session. */
function setTableLabel() { syncSession(); }
/* Create/restore the cart session on load (replaces the table prompt).
   Reads an optional QR location hint for checkout, and restores the
   persisted cart so a refresh / re-scan never loses items. */
function ensureTable() {
  Store.touchCartSession();                 // create-or-restore + slide expiry
  state.locationIdentifier = (typeof readTableFromURL === 'function' ? readTableFromURL() : null) || null;
  // Pre-fill the optional checkout location field from the QR hint.
  const locEl = $('#locationInput');
  if (locEl && state.locationIdentifier) locEl.value = state.locationIdentifier;
  state.cart = Store.getCart() || [];       // restore persisted cart
  syncSession();
}
/* The table picker no longer exists — these are safe no-ops so any
   remaining legacy callers don't throw. */
function openTableModalPrefilled() {}
function tableModalDismissible() { return true; }
function openTableModal()  {}
function closeTableModal() {}
function setTableTab() {}

/* Display name used for chat presence / message authorship: the
   signed-in customer's name, otherwise "Guest" (never the opaque
   session id). */
function customerChatName() {
  const c = Store.getCustomer && Store.getCustomer();
  return (c && c.name) || 'Guest';
}

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
        ${thumbMarkup(item, { alt: item.name })}
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
/* Align the menu so its first item sits just BELOW the sticky chips
   bar (instead of hidden behind it). The tricky part: scrolling up
   toward the menu start crosses back under the 30vh dock threshold,
   which UN-docks the view — the topbar slides back in and the chips
   drop below it. So we must aim at the resting state, not the current
   one: predict whether we'll land docked (topbar hidden, stack = chips)
   or un-docked (topbar shown, stack = topbar + chips) and offset by
   the right amount. */
function alignMenuUnderChips() {
  const chips = $('#categoryChips');
  const grid  = $('#menuGrid');
  if (!chips || !grid) return;
  const gridDocTop = grid.getBoundingClientRect().top + window.scrollY;  // stable (grid isn't sticky)
  const chipsH  = chips.offsetHeight;
  const topbarH = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')
  ) || 0;
  const undockBound = window.innerHeight * 0.30 * 0.8;   // matches the JS hysteresis
  // Assume we'll land un-docked (the common case — the menu is near the
  // top). If that target is still deep enough to stay docked, switch to
  // the docked offset (chips only).
  let target = gridDocTop - topbarH - chipsH;
  if (target >= undockBound) target = gridDocTop - chipsH;
  target = Math.max(0, target);
  // Only correct when the first item is actually tucked under the bar.
  if (window.scrollY > target + 1) window.scrollTo({ top: target, behavior: 'smooth' });
}
$('#categoryChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  if (chip.dataset.category === state.category) return;   // no-op, no reflow
  $$('.chip', $('#categoryChips')).forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  state.category = chip.dataset.category;
  renderMenu();
  alignMenuUnderChips();
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
  if (line.qty <= 0) { state.cart = state.cart.filter(l => l.lineKey !== key); updateCart(); return; }
  // Patch ONLY this row + the totals instead of rebuilding the whole
  // list, so the cart drawer keeps its scroll position and the +/-
  // button you're tapping stays put (no jump / lost focus).
  const item = MENU.find(m => m.id === line.id);
  const row  = [...cartItemsEl.querySelectorAll('.cart-item')].find(el => el.dataset.key === key);
  if (item && row) {
    const qtySpan = row.querySelector('.qty-row span');
    if (qtySpan) qtySpan.textContent = line.qty;
    const priceEl = row.querySelector('.item-price');
    if (priceEl) priceEl.textContent = peso(unitPrice(item, line.config) * line.qty);
    refreshCartChrome();
  } else {
    updateCart();                       // row not found — fall back to a full render
  }
}
function removeLine(key) {
  state.cart = state.cart.filter(l => l.lineKey !== key);
  updateCart();
}
function clearCart() {
  state.cart = [];
  updateCart();
}

/* FAB count/total + drawer total + place-order button + in-cart badges.
   Split out so a single qty change can refresh these without rebuilding
   the whole cart list (see changeQty). */
function refreshCartChrome() {
  // Persist the cart to the session on every change (add / qty / remove
  // / clear all funnel through here), so a refresh or QR re-scan never
  // loses items. Skipped while editing an existing order (that pulls the
  // order's items into the cart temporarily — not the real cart).
  if (!state.editingOrderId && Store.setCart) Store.setCart(state.cart);
  const { subtotal, count } = cartTotals();
  $('#fabCartCount').textContent = count;
  $('#fabCartTotal').textContent = peso(subtotal);
  // Cart button stays visible even when empty (tapping opens the cart's
  // empty state) — only the `is-empty` class dials it down visually.
  const cartFab = $('#fabCartBtn');
  cartFab.classList.remove('hidden-empty');
  cartFab.classList.toggle('is-empty', count === 0);
  cartTotalEl.textContent = peso(subtotal);
  $('#placeOrderBtn').disabled = count === 0;
  updateInCartBadges();
}

function updateCart() {
  // Drawer list
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
            ${thumbMarkup(item)}
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

  refreshCartChrome();
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
  // Guard against the "re-render during click" trap: if an in-UI action
  // (e.g. "Select to clear" / toggling the Cancelled group) rebuilt the
  // list, the clicked node is now detached from the DOM. A detached
  // target can never be a genuine click-away, so bail before any of the
  // outside-close checks below treat it as one and close the surface.
  if (!t.isConnected) return;
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

  // Chat: clicking away from the open chat closes it (same as the cart
  // and my-orders sheets). Exclude the openers (so the tap that opens it
  // doesn't immediately close it) and anything inside the drawer or a
  // modal layered over it.
  // Docked (desktop two-pane) chat is part of the layout, not an
  // overlay, so it never auto-closes on outside clicks.
  if (chatDrawer.classList.contains('open') && !chatDrawer.classList.contains('docked')) {
    let close = true;
    if (chatDrawer.contains(t))            close = false;
    else if (t.closest('.fab-chat'))       close = false;   // customer opener
    else if (t.closest('.chat-act-btn'))   close = false;   // legacy admin opener
    else if (t.closest('.chat-thread'))    close = false;   // admin convo-list opener
    else if (t.closest('.modal'))          close = false;   // dialog over the chat
    if (close) closeChat();
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
  $('#czImage').innerHTML = thumbMarkup(item, { loading: 'eager', fallbackStyle: 'font-size:2rem' });
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
/* Optional location note attached at checkout (e.g. "Table 12",
   "Near window"). Priority: what the customer typed in the cart's
   location field; otherwise the QR ?table= hint captured on load.
   Null when neither is present — orders are session-based, not
   table-bound. */
function readCheckoutLocation() {
  const el = $('#locationInput');
  const typed = el ? el.value.trim() : '';
  return typed || state.locationIdentifier || null;
}
$('#placeOrderBtn').addEventListener('click', async () => {
  if (state.cart.length === 0) return;
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
      locationIdentifier: readCheckoutLocation(),
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
  // Reset the location field back to the QR default (if any) so the
  // next order starts clean rather than reusing a one-off note.
  const locEl = $('#locationInput');
  if (locEl) locEl.value = state.locationIdentifier || '';

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
   the cart and switch the cart into update mode. Available on the
   same terms as Cancel (only while the order is still pending). */
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

/* Re-order a finished (served / cancelled) order: drop its items into a
   fresh cart for review/modification. Unlike Modify this places a NEW
   order — it never edits or revives the original. */
function reorderIntoCart(order) {
  finishEditingOrder();          // ensure we're not in update mode
  clearCart();
  let added = 0;
  for (const it of order.items) {
    if (!MENU.find(m => m.id === it.itemId)) continue;   // skip removed items
    addLine(it.itemId, JSON.parse(JSON.stringify(it.config || {})), it.qty);
    added++;
  }
  if (!added) { showToast('Those items are no longer on the menu', 'error'); return; }
  closeMyOrders();
  openCart();
  showToast('Added to your cart — review, then place your order', 'success');
}

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

/* Clear this device's guest visit (table label, active order, cart) and
   mint a fresh clientId — so a previous guest's table name and active
   orders don't linger when a customer/admin signs in or out. Orders
   already placed stay in the store; the fresh id just detaches them
   from this device's "My orders" view. */
function resetCustomerVisitState() {
  clearActiveOrder();
  finishEditingOrder();
  clearCart();
  Store.clearSessionTable();
  Store.resetClientId();            // fresh device id → clean guest slate
  Store.touchCartSession();         // rebind the cart session to the new id
  state.cart = Store.getCart() || [];
  syncSession();                    // re-read the (new) session id
  updateCart();
  refreshMyOrdersFab();
  refreshOrderStatusBanner();
  if (!$('#myOrdersSheet').hidden) renderMyOrdersList();
}

/* On sign-in: clear any guest leftovers, then resume the account's OWN
   active orders if it has any (re-adopting its clientId + table so no
   PIN/table re-entry is needed). Returns true if orders were resumed. */
async function resumeOrClearOnLogin() {
  // One role at a time: signing in as a customer drops any admin
  // session on this device (and vice versa, in the staff login).
  if (Store.getSession()) {
    Store.logout();
    if (typeof exitAdminPanel === 'function') exitAdminPanel();
    if (typeof refreshAdminHeaderBtn === 'function') refreshAdminHeaderBtn();
  }
  const cust = Store.getCustomer && Store.getCustomer();
  if (!cust) return 0;
  // Account-switch guard on a SHARED device: if this session already
  // holds orders owned by a DIFFERENT account, require explicit
  // confirmation before re-linking them (strict account separation).
  if (Store.sessionOrdersForeignTo(cust.id)) {
    const ok = await confirmAsk(
      'This device has orders linked to a different account. Move them to ' +
      `${cust.name || 'your account'}? Only do this if they're yours.`,
      { title: 'Switch accounts?', confirmLabel: 'Link to my account', cancelLabel: 'Keep them separate', danger: true }
    );
    if (!ok) {
      // Decline → start a clean session so the other account's orders
      // never surface under this login.
      Store.resetClientId();
      Store.setCart([]); state.cart = [];
      syncSession();
      updateCart();
      refreshMyOrdersFab();
      refreshOrderStatusBanner();
      if (!$('#myOrdersSheet').hidden) renderMyOrdersList();
      return 0;
    }
  }
  // Link this session's guest orders to the account (idempotent — keeps
  // the original orderId, only attaches userId), then credit any points
  // from completed orders so migrated orders count toward rewards.
  const linked = Store.linkSessionOrdersToAccount(cust.id);
  reconcileCustomerPoints();
  refreshMyOrdersFab();
  refreshOrderStatusBanner();
  if (!$('#myOrdersSheet').hidden) renderMyOrdersList();
  return linked;
}
/* Case-insensitive table-label compare (labels are free text). */
function sameLabel(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function getActiveOrder() {
  // Prefer the explicitly-stored last-placed order — but ONLY while it
  // still belongs to THIS session/device. Otherwise the banner could
  // cling to an order from a different account.
  const id = localStorage.getItem('bossb_active_order');
  if (id) {
    const mine = new Set(Store.getMyClientIds ? Store.getMyClientIds() : [Store.getClientId()]);
    const stored = Store.getOrders().find(o => o.id === id);
    if (stored && mine.has(stored.clientId)) return stored;
  }
  // Otherwise track this session's most recent active order.
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
    osbReset();
    return;
  }
  const info = STATUS_INFO[order.status] || STATUS_INFO.pending;
  const wasHidden = banner.hidden;
  banner.hidden = false;
  $('#orderStatusBtn').dataset.status = order.status;
  $('#bannerOrderNumber').textContent = order.number;
  $('#bannerStatusText').textContent  = info.text;
  $('#bannerStatusIcon').textContent  = info.icon;
  // Start the collapse countdown when the banner first appears; pop it
  // back out if the status changed while it was tucked into the cube.
  if (wasHidden) { osbLastStatus = order.status; osbScheduleCollapse(); }
  else if (order.status !== osbLastStatus) {
    osbLastStatus = order.status;
    if (banner.classList.contains('collapsed')) osbExpand();
  }

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
  // Optional free-text location note (e.g. "Table 12"); hidden when none.
  const placedLoc = $('#placedTable');
  if (placedLoc) {
    if (order.locationIdentifier) { placedLoc.textContent = order.locationIdentifier; placedLoc.hidden = false; }
    else { placedLoc.textContent = ''; placedLoc.hidden = true; }
  }
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
  // No table PIN in the session model — keep the row hidden if present.
  const pinRow = $('#placedPinRow');
  if (pinRow) pinRow.hidden = true;
  $('#newOrderBtn').textContent = (order.status === 'served' || order.status === 'cancelled')
    ? 'Start new order'
    : 'Place another order';

  // The order the customer just placed is now managed from the
  // "My orders" sheet (cancel / modify there) instead of an inline
  // cancel button in this modal.
}

$('#placedMyOrdersBtn').addEventListener('click', () => {
  closeModal('#orderPlacedModal');
  openMyOrders();
});

/* ==========================================================
   ORDER-STATUS BANNER — auto-collapse + best-seller carousel
   A few seconds after the status banner appears it tucks itself
   into a small cube on the right (arrow flips to ‹), freeing the
   space for an auto-scrolling Top-10 best-seller carousel. Tapping
   the cube restores the full status (and re-arms the countdown);
   a status change also pops it back out so the customer sees it.
   Tapping a carousel card opens that product.
   ========================================================== */
const OSB_COLLAPSE_MS = 5000;     // delay before the status tucks away
const OSB_SLIDE_MS    = 3000;     // carousel auto-advance cadence
let osbCollapseTimer = null;
let osbAutoTimer     = null;
let osbLastStatus    = null;

function getBestSellers(limit = 10) {
  const counts = new Map();
  Store.getOrders().forEach(o => (o.items || []).forEach(it => {
    if (!it.itemId) return;
    counts.set(it.itemId, (counts.get(it.itemId) || 0) + (Number(it.qty) || 1));
  }));
  const ranked = MENU.slice()
    .map(m => ({ m, n: counts.get(m.id) || 0 }))
    .sort((a, b) => b.n - a.n);
  let list = ranked.filter(r => r.n > 0).map(r => r.m);
  if (list.length < limit) {                       // pad with the rest of the menu
    const have = new Set(list.map(m => m.id));
    list = list.concat(MENU.filter(m => !have.has(m.id)));
  }
  return list.slice(0, limit);
}

function renderBestSellerCarousel() {
  const track = $('#osbTrack');
  if (!track) return;
  track.innerHTML = getBestSellers(10).map((m, i) => `
    <button type="button" class="osb-card" data-id="${escapeHtml(m.id)}">
      <span class="osb-thumb">${thumbMarkup(m, { alt: m.name })}</span>
      <span class="osb-info">
        <span class="osb-rank">#${i + 1} Best seller</span>
        <span class="osb-name">${escapeHtml(m.name)}</span>
      </span>
      <span class="osb-price">${peso(m.price)}</span>
    </button>`).join('');
}

function osbAutoplayStop() { if (osbAutoTimer) { clearInterval(osbAutoTimer); osbAutoTimer = null; } }
function osbAutoplayStart() {
  osbAutoplayStop();
  const track = $('#osbTrack');
  if (!track) return;
  osbAutoTimer = setInterval(() => {
    if (!track.children.length) return;
    const card = track.querySelector('.osb-card');
    const step = card ? card.offsetWidth + 8 : 160;
    const max  = track.scrollWidth - track.clientWidth;
    if (track.scrollLeft >= max - 4) track.scrollTo({ left: 0, behavior: 'smooth' });
    else track.scrollBy({ left: step, behavior: 'smooth' });
  }, OSB_SLIDE_MS);
}

function osbCollapse() {
  const banner = $('#orderStatusBanner');
  if (!banner || banner.hidden) return;
  renderBestSellerCarousel();
  banner.classList.add('collapsed');
  const car = $('#osbCarousel');
  if (car) car.setAttribute('aria-hidden', 'false');
  osbAutoplayStart();
}
function osbExpand() {
  const banner = $('#orderStatusBanner');
  if (!banner) return;
  banner.classList.remove('collapsed');
  const car = $('#osbCarousel');
  if (car) car.setAttribute('aria-hidden', 'true');
  osbAutoplayStop();
  osbScheduleCollapse();          // re-arm so it tucks away again shortly
}
function osbScheduleCollapse() {
  clearTimeout(osbCollapseTimer);
  osbCollapseTimer = setTimeout(osbCollapse, OSB_COLLAPSE_MS);
}
function osbReset() {
  clearTimeout(osbCollapseTimer);
  osbAutoplayStop();
  osbLastStatus = null;
  const banner = $('#orderStatusBanner');
  if (banner) banner.classList.remove('collapsed');
}

/* Banner click: when tucked into the cube, restore it; otherwise open
   the My-orders sheet (most customers have 2+ orders, so the popup is
   the more useful default). */
$('#orderStatusBtn').addEventListener('click', () => {
  const banner = $('#orderStatusBanner');
  if (banner && banner.classList.contains('collapsed')) osbExpand();
  else openMyOrders();
});

/* Carousel card → open that product. Pause autoplay while the user is
   hovering/touching so it doesn't slide out from under their tap. */
const osbTrackEl = $('#osbTrack');
if (osbTrackEl) {
  let dragging = false, dragMoved = false, startX = 0, startScroll = 0, dragPointer = null;

  osbTrackEl.addEventListener('click', (e) => {
    // Swallow the click that ends a drag so it doesn't open a product.
    if (dragMoved) { e.preventDefault(); e.stopPropagation(); return; }
    const card = e.target.closest('.osb-card');
    if (!card) return;
    openCustomizer(card.dataset.id);
  });

  // Desktop mice only have a vertical wheel — translate it to horizontal
  // scroll so the carousel is reachable without a trackpad.
  osbTrackEl.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;   // already horizontal intent
    e.preventDefault();
    osbTrackEl.scrollLeft += e.deltaY;
    osbAutoplayStop();
  }, { passive: false });

  // Click-and-drag to scroll (mouse / pen). Touch keeps native swipe.
  osbTrackEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    dragging = true; dragMoved = false;
    startX = e.clientX; startScroll = osbTrackEl.scrollLeft;
    dragPointer = e.pointerId;
    try { osbTrackEl.setPointerCapture(dragPointer); } catch (_) {}
    osbTrackEl.classList.add('dragging');
    osbAutoplayStop();
  });
  osbTrackEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) dragMoved = true;
    osbTrackEl.scrollLeft = startScroll - dx;
  });
  const endOsbDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (dragPointer != null) { try { osbTrackEl.releasePointerCapture(dragPointer); } catch (_) {} dragPointer = null; }
    osbTrackEl.classList.remove('dragging');
    // Clear the "moved" flag AFTER the click handler above has run.
    setTimeout(() => { dragMoved = false; }, 0);
  };
  osbTrackEl.addEventListener('pointerup', endOsbDrag);
  osbTrackEl.addEventListener('pointercancel', endOsbDrag);

  osbTrackEl.addEventListener('pointerenter', osbAutoplayStop);
  osbTrackEl.addEventListener('pointerleave', () => {
    if (!dragging && $('#orderStatusBanner')?.classList.contains('collapsed')) osbAutoplayStart();
  });
}

/* ==========================================================
   MY ORDERS  (multi-order popup + FAB + thank-you reset)
   - FAB shows live count of THIS device's pending/preparing.
   - Popup is scrollable, shows every order this device placed,
     and exposes the customer self-cancel button per order while
     the order is still pending.
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
  // Session model: "here" is this device's session, so active orders are
  // simply this session's pending/preparing orders.
  return getMyActiveOrders();
}

function refreshMyOrdersFab() {
  const activeOrders = getActiveOrdersHere();   // newest first
  const active = activeOrders.length;
  const fab = $('#fabMyOrdersBtn');
  // Always visible: in the session model this pill is the customer's
  // anchor (order #, history, points, account) — it must stay reachable
  // even after every order is served, and even before the first order.
  fab.hidden = false;
  document.body.classList.add('has-myorders-fab');
  // Surface the latest active order number right on the pill so the
  // customer can tell staff "I'm order #N" at a glance. Falls back to a
  // plain label when nothing is in flight.
  const txt   = fab.querySelector('.fab-myorders-text');
  const badge = $('#fabMyOrdersBadge');
  if (active > 0) {
    if (txt) txt.textContent = `Order #${activeOrders[0].number}`;
    if (badge) { badge.textContent = active; badge.hidden = (active < 2); }
  } else {
    if (txt) txt.textContent = 'My orders';
    if (badge) badge.hidden = true;
  }
  // Chat FAB only appears once this session has an order to talk about.
  const chatFab = $('#fabChatBtn');
  if (chatFab) {
    chatFab.hidden = (Store.getMyOrders().length === 0);
  }
}

function openMyOrders() {
  const sheet = $('#myOrdersSheet');
  sheet.hidden = false;
  sheet.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => sheet.classList.add('open'));
  renderMyOrdersList();
  // Auto-refresh while open, but only actually rebuild when the data
  // changes (see tickMyOrders) — keeps the list from jumping / closing
  // the Cancelled group every second.
  if (myOrdersTicker) clearInterval(myOrdersTicker);
  myOrdersTicker = setInterval(tickMyOrders, 1000);
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
  cancelledOpen = false;                // next open starts with the group collapsed
  myOrdersSig = null;                   // force a fresh render on reopen
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
// The header tier chip jumps to the profile (where the full tier
// progress + perks live).
$('#myOrdersTierChip')?.addEventListener('click', () => { if (Store.isCustomer && Store.isCustomer()) openProfile(); });
$('#endVisitBtn')?.addEventListener('click', endVisit);

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
/* Finished-order clearing: ticked orders (multi-select) live here; a
   swipe gesture clears a single one. No separate "select mode" anymore. */
const selectedToClear = new Set();
let mySwipeActive = false;   // true while a swipe-to-clear drag is in flight
// Remembers whether the collapsible "Cancelled" group is expanded so a
// re-render doesn't snap it shut under the user.
let cancelledOpen = false;
// Last-rendered data signature — the 1s ticker re-renders ONLY when this
// changes, so an idle sheet doesn't rebuild (and jump) every second.
let myOrdersSig = null;

/* A compact fingerprint of everything the My-orders list draws from.
   Re-render is needed only when this changes. Includes a 30s time bucket
   so "x min ago" stays roughly fresh without per-second churn, and the
   cancellable flag so the grace-window Cancel button disappears on time. */
function myOrdersSignature() {
  const dismissed = dismissedOrderIds();
  const orders = Store.getMyOrders().filter(o => !dismissed.has(o.id));
  const bucket = Math.floor(Date.now() / 30000);   // 30s resolution
  const rows = orders.map(o =>
    `${o.id}:${o.status}:${Store.isCancellableByCustomer(o) ? 1 : 0}`).join('|');
  const perks = (Store.isCustomer && Store.isCustomer())
    ? `${Store.getPerks().points || 0}/${(Store.getPerks().vouchers || []).length}` : 'g';
  return `${rows}#${[...selectedToClear].sort().join(',')}#${cancelledOpen ? 1 : 0}#${perks}#${bucket}`;
}

/* The interval-driven refresh. Cheap no-op when nothing changed, and it
   never fires mid-selection or mid-swipe (so the gesture isn't interrupted). */
function tickMyOrders() {
  if (selectedToClear.size || mySwipeActive) return;   // don't rebuild while clearing
  const sig = myOrdersSignature();
  if (sig === myOrdersSig) return;            // nothing changed → no churn
  renderMyOrdersList();
}

function renderMyOrdersList() {
  const myId = Store.getClientId();
  // Session-based: this device's own orders, plus (when signed in) any
  // orders linked to the account. Dismissed (cleared) orders are hidden.
  const dismissed = dismissedOrderIds();
  const orders = Store.getMyOrders().filter(o => !dismissed.has(o.id));
  const host   = $('#myOrdersList');
  const active = orders.filter(o => o.status === 'pending' || o.status === 'preparing').length;
  $('#myOrdersSummary').textContent = active === 0
    ? `${orders.length} total`
    : `${active} active · ${orders.length} total`;

  // Header tier chip — shown for signed-in customers; taps open profile.
  const tierChip = $('#myOrdersTierChip');
  if (tierChip) {
    if (Store.isCustomer && Store.isCustomer()) {
      $('#myOrdersTierName').textContent = Store.tierStatus().name;
      tierChip.hidden = false;
    } else {
      tierChip.hidden = true;
    }
  }

  // No "End my visit" in the session model — the session persists per
  // device and expires on its own. Keep the footer hidden if present.
  const foot = $('#myOrdersFoot');
  if (foot) foot.hidden = true;

  // Today's spending strip — the customer's OWN non-cancelled
  // orders placed today.
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const todays = orders.filter(o => {
    if (o.clientId !== myId) return false;
    if (o.status === 'cancelled') return false;
    const t = new Date(o.placedAt);
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  });
  const todayTotal = todays.reduce((s, o) => s + (o.total || 0), 0);

  // CTA changes by state:
  //  • guest            → prompt to create an account
  //  • member + voucher → highlight the savings on their next order
  //  • member, no voucher → a quiet "you've spent ₱X this …!" note
  let ctaHtml;
  if (Store.isCustomer && Store.isCustomer()) {
    const activeVouchers = (Store.getPerks().vouchers || []).filter(v => !v.used);
    if (activeVouchers.length) {
      const bestPct = Math.max(...activeVouchers.map(v => v.discountPct || 0));
      const avg = Store.avgOrderValue();
      const est = avg ? Math.round((bestPct / 100) * avg) : 0;
      ctaHtml = `
        <div class="myorders-cta loggedin">
          <strong>🎟️ Saving ${est ? peso(est) : bestPct + '%'} with your voucher</strong>
          <p class="muted small">Applied at the counter on your next order.</p>
        </div>`;
    } else {
      const s = Store.spendSummary();
      let amount = 0, label = 'so far';
      if (s.week > 0)       { amount = s.week;  label = 'this week'; }
      else if (s.month > 0) { amount = s.month; label = 'this month'; }
      else if (s.year > 0)  { amount = s.year;  label = 'this year'; }
      else                  { amount = s.lifetime; label = 'so far'; }
      ctaHtml = amount > 0
        ? `<div class="myorders-cta loggedin"><p class="spend-note">💸 You've spent <strong>${peso(amount)}</strong> ${label}!</p></div>`
        : `<div class="myorders-cta loggedin"><p class="spend-note muted">Order something to start earning rewards 🌱</p></div>`;
    }
  } else {
    ctaHtml = `
      <div class="myorders-cta" data-loggedin="false">
        <strong>Today's spending: ${peso(todayTotal)}</strong>
        <p>To save your spending history and earn rewards, sign in or create an account.</p>
        <a href="signup.html" class="btn btn-primary btn-block">Create an account</a>
      </div>`;
  }

  if (orders.length === 0) {
    host.innerHTML = `<p class="empty-state">No orders yet.</p>` + ctaHtml;
    return;
  }

  // Every order in this list belongs to this session/account.
  const myCancellable = orders.filter(o => Store.isCancellableByCustomer(o));
  const myClearable   = orders.filter(o => o.status === 'served' || o.status === 'cancelled');
  // Toolbar: cancel-all for open orders, plus a hint about how to clear
  // finished ones (swipe a row, or tick to multi-select). Finished orders
  // always carry a checkbox now — there's no separate "select mode".
  const toolbarBtns = [];
  if (myCancellable.length) {
    toolbarBtns.push(`<button class="btn btn-ghost btn-mini" data-act="cancel-all">Cancel all (${myCancellable.length})</button>`);
  }
  if (myClearable.length && !selectedToClear.size) {
    toolbarBtns.push(`<span class="myorders-selhint">Swipe a finished order to clear it, or tick to select several.</span>`);
  }
  const toolbarHtml = toolbarBtns.length
    ? `<div class="myorders-toolbar">${toolbarBtns.join('')}</div>` : '';

  const rowHtml = (o) => {
    const info  = STATUS_INFO[o.status] || STATUS_INFO.pending;
    // Finished orders (served / cancelled) carry an always-visible
    // checkbox for multi-select and can be swiped away to clear.
    const finished = (o.status === 'served' || o.status === 'cancelled');
    const itemsHtml = o.items.map(i => {
      const menuItem = MENU.find(m => m.id === i.itemId);
      const thumb = `<span class="myo-thumb">${thumbMarkup(menuItem, { fallbackClass: 'myo-thumb-ph' })}</span>`;
      return `<li>${thumb}<span class="myo-name">${i.qty}× ${escapeHtml(i.name)}</span><span class="myo-price">${peso(i.unitPrice * i.qty)}</span></li>`;
    }).join('');
    const cancellable = Store.isCancellableByCustomer(o);
    const reorderable = finished;
    const isChecked = finished && selectedToClear.has(o.id);
    const loc = o.locationIdentifier
      ? `<small class="muted myorder-loc"> · 📍 ${escapeHtml(String(o.locationIdentifier))}</small>` : '';
    return `
      <article class="myorder-item${finished ? ' swipeable' : ''}${isChecked ? ' selected' : ''}" data-id="${o.id}" data-status="${o.status}">
        <header>
          <div>
            ${finished ? `<label class="myo-select"><input type="checkbox" data-clear-id="${o.id}"${isChecked ? ' checked' : ''} aria-label="Select to clear"></label>` : ''}
            <strong>Order #${o.number}</strong>${loc}
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
            ? `<button class="btn btn-ghost btn-modify-grace" data-act="modify">Modify</button>
               <button class="btn btn-cancel-grace" data-act="cancel">Cancel</button>`
            : reorderable
              ? `<button class="btn btn-ghost btn-mini" data-act="reorder">🔁 Reorder</button>`
              : ''}
        </footer>
      </article>
    `;
  };
  // Active + finished orders render inline; cancelled ones tuck into a
  // collapsible group so they don't clutter the live list.
  const activeOrders    = orders.filter(o => o.status !== 'cancelled');
  const cancelledOrders = orders.filter(o => o.status === 'cancelled');
  const orderRows = activeOrders.map(rowHtml).join('');
  const cancelledHtml = cancelledOrders.length
    ? `<details class="myorders-cancelled"${cancelledOpen ? ' open' : ''}>
         <summary>Cancelled (${cancelledOrders.length})</summary>
         <div class="myorders-cancelled-list">${cancelledOrders.map(rowHtml).join('')}</div>
       </details>`
    : '';
  // Logged-in customer's available vouchers, shown right in My Orders.
  let vouchersHtml = '';
  if (Store.isCustomer && Store.isCustomer()) {
    const active = (Store.getPerks().vouchers || []).filter(v => !v.used);
    if (active.length) {
      vouchersHtml = `<div class="myorders-vouchers">
        <div class="mv-title">🎟️ Your vouchers</div>
        ${active.map(v => `<div class="mv-item"><span class="mv-code">${escapeHtml(v.code)}</span><span>${v.discountPct}% off${v.fromStaff ? ' · gift' : ''}</span></div>`).join('')}
      </div>`;
    }
  }
  // Pinned action dock — appears whenever at least one finished order is
  // ticked, and stays stuck to the bottom (position: sticky) so Clear /
  // Deselect never scroll out of view while ticking boxes further up.
  const dockHtml = selectedToClear.size
    ? `<div class="myorders-dock">
         <span class="dock-count">${selectedToClear.size} selected</span>
         <button class="btn btn-ghost btn-mini" data-act="select-done">Deselect</button>
         <button class="btn btn-danger btn-mini" data-act="clear-selected">Clear (${selectedToClear.size})</button>
       </div>`
    : '';

  // Preserve scroll position across the innerHTML swap so a refresh never
  // jumps the list back to the top while the customer is reading/selecting.
  const prevScroll = host.scrollTop;
  host.innerHTML = vouchersHtml + toolbarHtml + orderRows + cancelledHtml + ctaHtml + dockHtml;
  host.scrollTop = prevScroll;

  // Keep cancelledOpen in sync when the user toggles the group (the
  // `toggle` event doesn't bubble, so bind it on the fresh node).
  const det = host.querySelector('.myorders-cancelled');
  if (det) det.addEventListener('toggle', () => {
    cancelledOpen = det.open;
    myOrdersSig = myOrdersSignature();   // keep in sync so the tick doesn't rebuild
  });

  // Record what we just drew so the ticker can skip redundant rebuilds.
  myOrdersSig = myOrdersSignature();
}

/* Track checkbox selection for the multi-select clear (re-render reads
   selectedToClear back, so state survives). */
$('#myOrdersList').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-clear-id]');
  if (!cb) return;
  if (cb.checked) selectedToClear.add(cb.dataset.clearId);
  else            selectedToClear.delete(cb.dataset.clearId);
  // Re-render so the pinned dock's count + visibility update immediately.
  renderMyOrdersList();
});

/* Swipe-to-clear: drag a finished order row left to dismiss it from the
   list (touch + mouse). Delegated on the stable list node so it survives
   re-renders. Vertical drags fall through to normal scrolling. */
(function wireMyOrdersSwipe() {
  const list = $('#myOrdersList');
  if (!list) return;
  const THRESHOLD = 90;                 // px left before it counts as a clear
  let row = null, id = null, startX = 0, startY = 0, dx = 0, decided = false, horizontal = false, pid = null;

  const reset = () => { row = null; id = null; dx = 0; decided = false; horizontal = false; pid = null; mySwipeActive = false; };

  list.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('input, button, label, a')) return;   // let controls work
    const r = e.target.closest('.myorder-item.swipeable');
    if (!r) return;
    row = r; id = r.dataset.id; startX = e.clientX; startY = e.clientY;
    dx = 0; decided = false; horizontal = false; pid = e.pointerId;
  });

  list.addEventListener('pointermove', (e) => {
    if (!row || e.pointerId !== pid) return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (!decided) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      decided = true;
      horizontal = Math.abs(mx) > Math.abs(my);
      if (horizontal) {
        mySwipeActive = true;
        row.classList.add('swiping');
        try { list.setPointerCapture(pid); } catch (_) {}
      } else {
        row = null;                     // vertical → release to the scroller
        return;
      }
    }
    if (!horizontal) return;
    dx = Math.min(0, mx);               // only allow leftward
    row.style.transform = `translateX(${dx}px)`;
    row.style.opacity = String(Math.max(0.25, 1 + dx / 260));
    e.preventDefault();
  });

  const endSwipe = (e) => {
    if (!row || (pid != null && e.pointerId !== pid)) return;
    const r = row, theId = id, wasHorizontal = horizontal, finalDx = dx;
    try { if (pid != null) list.releasePointerCapture(pid); } catch (_) {}
    reset();
    if (!wasHorizontal) return;
    r.classList.remove('swiping');
    if (finalDx <= -THRESHOLD) {
      r.style.transform = 'translateX(-110%)';
      r.style.opacity = '0';
      setTimeout(() => {
        dismissOrders([theId]);
        selectedToClear.delete(theId);
        renderMyOrdersList();
        refreshMyOrdersFab();
      }, 180);
    } else {
      r.style.transform = '';           // snap back
      r.style.opacity = '';
    }
  };
  list.addEventListener('pointerup', endSwipe);
  list.addEventListener('pointercancel', endSwipe);
})();

$('#myOrdersList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  // ----- Toolbar / banner actions (not tied to a single order) -----
  if (act === 'cancel-all') {
    const myId = Store.getClientId();
    const targets = Store.getMyOrders().filter(o => Store.isCancellableByCustomer(o));
    if (!targets.length) return;
    if (!(await confirmAsk(`Cancel all ${targets.length} of your open order${targets.length === 1 ? '' : 's'}?`, {
      title: 'Cancel all orders', confirmLabel: 'Cancel all', cancelLabel: 'Keep them', danger: true,
    }))) return;
    let ok = 0;
    targets.forEach(o => { if (Store.customerCancelOrder(o.id).ok) ok++; });
    showToast(ok ? `Cancelled ${ok} order${ok === 1 ? '' : 's'}` : 'Nothing could be cancelled', ok ? 'success' : 'error');
    renderMyOrdersList(); refreshMyOrdersFab(); refreshOrderStatusBanner();
    return;
  }
  if (act === 'select-done') { selectedToClear.clear(); renderMyOrdersList(); return; }   // Deselect all
  if (act === 'clear-selected') {
    if (!selectedToClear.size) return;
    dismissOrders([...selectedToClear]);
    showToast(`Cleared ${selectedToClear.size} from your list`, 'success');
    selectedToClear.clear();
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
      showToast('Already being prepared — ask staff.', 'error');
      renderMyOrdersList();
      return;
    }
    startEditingOrder(order);
    return;
  }

  if (act === 'reorder') {
    const order = Store.getOrders().find(o => o.id === id);
    if (order) reorderIntoCart(order);
    return;
  }

  if (act === 'cancel') {
    if (!(await confirmAsk('Cancel this order?', {
      title: 'Cancel order', confirmLabel: 'Cancel order', cancelLabel: 'Keep it', danger: true,
    }))) return;
    const result = Store.customerCancelOrder(id);
    if (!result.ok) {
      showToast(
        result.reason === 'already_started' ? 'Already being prepared — ask staff.' : 'Could not cancel.',
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
   as history; new orders will append.

   Crucially we keep `thanksShown` TRUE here: the all-served
   condition is still true the instant the overlay is dismissed,
   so re-arming it now would make the next banner tick (fired on
   scroll/poll) immediately re-show the overlay in a loop. The
   lockout is re-armed only when the customer places a NEW order
   (see placeOrder), which is the real start of a fresh round. */
function continueAsSameUser() {
  dismissThanks();
  closeMyOrders();
  bumpInactivity();
  showToast('Welcome back ☕ Add anything else?', 'success');
}
/* "End my visit" is gone in the session model (the footer button is
   hidden). Kept as a thin shim so the legacy click binding doesn't
   throw — it just starts a fresh order on this device. */
async function endVisit() {
  resetForNextCustomer();
}
/* "Start a new order" — a soft reset that clears the cart and the
   last-order banner so the customer can begin a fresh round on the
   same device/session. In the session model there is NO table to
   abolish, NO clientId reset, and NO table prompt: the session
   persists per device and expires on its own. */
function resetForNextCustomer() {
  clearActiveOrder();
  finishEditingOrder();             // drop any in-progress order edit
  clearCart();
  closeMyOrders();
  dismissThanks();
  thanksShown = false;
  refreshMyOrdersFab();
  refreshOrderStatusBanner();
}

/* ==========================================================
   INACTIVITY  (session model)
   The ordering identity is a persistent per-device session, not a
   shared table, so we never kick a customer back to a table prompt.
   bumpInactivity remains as a harmless no-op for the legacy callers
   that still reference it; the AFK auto-reset has been removed.
   ========================================================== */
function bumpInactivity() {}
function customerIsEngaged() {
  return state.cart.length > 0 || getMyActiveOrders().length > 0;
}
function hideAfkPrompt() { closeModal('#afkModal'); }
$('#afkStayBtn')?.addEventListener('click', () => { hideAfkPrompt(); });
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

/* Reusable promise-based confirm/alert modal — replaces native
   confirm()/alert(). Resolves the chosen button's `value` (or null if
   dismissed). Inner clicks never close it (bindBackdropClose only fires
   on the backdrop); pass dismissable:false to also block the backdrop. */
function uiConfirm({ title = '', message = '', buttons = [{ label: 'OK', value: true, variant: 'primary' }], dismissable = true } = {}) {
  return new Promise(resolve => {
    const modal = $('#uiConfirmModal');
    $('#uiConfirmTitle').textContent = title;
    $('#uiConfirmMsg').textContent   = message;
    const host = $('#uiConfirmBtns');
    host.innerHTML = '';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      modal._uiClose = null;
      closeModal('#uiConfirmModal');
      resolve(val);
    };
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ' + (b.variant === 'danger' ? 'btn-danger' : b.variant === 'ghost' ? 'btn-ghost' : 'btn-primary');
      btn.style.width = '100%';
      btn.textContent = b.label;
      btn.addEventListener('click', () => done(b.value));
      host.appendChild(btn);
    });
    modal._uiClose = dismissable ? () => done(null) : null;
    openModal('#uiConfirmModal');
  });
}
bindBackdropClose('#uiConfirmModal', () => { const m = $('#uiConfirmModal'); if (m && m._uiClose) m._uiClose(); });

/* Boolean convenience wrapper over uiConfirm — the drop-in replacement
   for native confirm(). Returns true only if the user taps the confirm
   button (backdrop/Esc/cancel all resolve false). Use danger:true for
   destructive actions to colour the confirm button red. */
async function confirmAsk(message, {
  title        = 'Please confirm',
  confirmLabel = 'Confirm',
  cancelLabel  = 'Cancel',
  danger       = false,
  dismissable  = true,
} = {}) {
  const val = await uiConfirm({
    title, message, dismissable,
    buttons: [
      { label: confirmLabel, value: true,  variant: danger ? 'danger' : 'primary' },
      { label: cancelLabel,  value: false, variant: 'ghost' },
    ],
  });
  return val === true;
}

/* Promise-based text-input modal — the drop-in replacement for native
   prompt(). Resolves the trimmed string the user entered, or null if
   they cancel / dismiss. `validate(value)` may return an error string to
   keep the dialog open with a message. Reuses the uiConfirm modal. */
function uiPrompt({
  title = '', message = '', placeholder = '', value = '',
  confirmLabel = 'OK', cancelLabel = 'Cancel', validate = null, dismissable = true,
} = {}) {
  return new Promise(resolve => {
    const modal = $('#uiConfirmModal');
    $('#uiConfirmTitle').textContent = title;
    $('#uiConfirmMsg').textContent   = message;
    const input = $('#uiConfirmInput');
    const errEl = $('#uiConfirmInputErr');
    const host  = $('#uiConfirmBtns');
    host.innerHTML = '';
    input.hidden = false;
    input.value = value || '';
    input.placeholder = placeholder || '';
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    let settled = false;
    const cleanup = () => {
      input.hidden = true;
      input.value = '';
      if (errEl) errEl.hidden = true;
      modal._uiClose = null;
      input.removeEventListener('keydown', onKey);
    };
    const done = (val) => {
      if (settled) return;
      settled = true;
      cleanup();
      closeModal('#uiConfirmModal');
      resolve(val);
    };
    const submit = () => {
      const v = input.value.trim();
      if (validate) {
        const err = validate(v);
        if (err) { if (errEl) { errEl.textContent = err; errEl.hidden = false; } input.focus(); return; }
      }
      done(v);
    };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    };
    input.addEventListener('keydown', onKey);

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn btn-primary';
    ok.style.width = '100%';
    ok.textContent = confirmLabel;
    ok.addEventListener('click', submit);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-ghost';
    cancel.style.width = '100%';
    cancel.textContent = cancelLabel;
    cancel.addEventListener('click', () => done(null));
    host.appendChild(ok);
    host.appendChild(cancel);

    modal._uiClose = dismissable ? () => done(null) : null;
    openModal('#uiConfirmModal');
    setTimeout(() => input.focus(), 60);
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const uiC = $('#uiConfirmModal');
  if (uiC && uiC.classList.contains('open')) { if (uiC._uiClose) uiC._uiClose(); return; }
  if ($('#customizerModal').classList.contains('open'))    return closeCustomizer();
  if ($('#staffLoginModal').classList.contains('open'))    return closeStaffLogin();
  if ($('#itemModal').classList.contains('open'))          return closeItemModal();
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
    closeTableModal();
    // One role at a time: if a customer is signed in on this device,
    // save their orders to their account and sign them out first.
    if (Store.getCustomer()) {
      Store.rememberOrdersForAccount();
      Store.logoutCustomer();
      if (typeof refreshProfileBtn === 'function') refreshProfileBtn();
    }
    // Sever the guest persona entirely: clear the table name + active
    // orders and mint a fresh clientId so the previous guest's visit
    // doesn't linger under the admin (those orders stay in the panel).
    resetCustomerVisitState();
    enterAdminPanel(session);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

/* ==========================================================
   CUSTOMER ACCOUNT  (sign in, profile, points, vouchers, loyalty)
   ========================================================== */
function openCustomerLogin()  { $('#customerLoginError').hidden = true; openModal('#customerLoginModal'); }
function closeCustomerLogin()  { closeModal('#customerLoginModal'); }
function openProfile()  { renderProfile(); openModal('#profileModal'); }
function closeProfile() { closeModal('#profileModal'); }

function refreshProfileBtn() {
  const btn = $('#profileBtn');
  if (!btn) return;
  btn.classList.toggle('is-authed', Store.isCustomer());
  btn.setAttribute('aria-label', Store.isCustomer() ? 'My account' : 'Sign in');
}

$('#profileBtn').addEventListener('click', () => {
  if (Store.isCustomer()) openProfile();
  else                    openCustomerLogin();
});
$('#closeCustomerLoginBtn').addEventListener('click', closeCustomerLogin);
$('#closeProfileBtn').addEventListener('click', closeProfile);
bindBackdropClose('#customerLoginModal', closeCustomerLogin);
bindBackdropClose('#profileModal', closeProfile);

$('#customerLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#customerLoginError');
  errEl.hidden = true;
  const fd = new FormData(e.target);
  try {
    const cust = await Store.loginCustomer({ email: fd.get('email'), password: fd.get('password') });
    e.target.reset();
    closeCustomerLogin();
    refreshProfileBtn();
    // Link this session's guest orders to the account (with the
    // account-switch confirmation when needed) and reconcile points.
    const linked = await resumeOrClearOnLogin();
    showToast(linked > 0
      ? `Welcome, ${cust.name} — ${linked} order${linked === 1 ? '' : 's'} added to your account`
      : `Welcome, ${cust.name}`, 'success');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

$('#customerLogoutBtn').addEventListener('click', () => {
  // Save this visit's orders to the account first, so they can be
  // resumed on next sign-in, then clear the device's guest state.
  Store.rememberOrdersForAccount();
  Store.logoutCustomer();
  closeProfile();
  refreshProfileBtn();
  resetCustomerVisitState();
  showToast('Signed out — your orders are saved to your account');
});

$('#redeemVoucherBtn').addEventListener('click', () => {
  try {
    const v = Store.redeemVoucher();
    showToast(`Voucher created — ${v.discountPct}% off`, 'success');
    renderProfile();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

/* Admin: grant a discount voucher to a customer by email. */
$('#grantVoucherForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#grantVoucherMsg');
  msg.hidden = true;
  const email = $('#grantVoucherEmail').value.trim();
  const pct   = $('#grantVoucherPct').value;
  try {
    const v = await Store.grantVoucher(email, pct);
    msg.hidden = false;
    msg.style.color = '#1f9d55';
    msg.textContent = `✓ Granted ${v.discountPct}% voucher (${v.code}) to ${email}`;
    e.target.reset();
  } catch (err) {
    msg.hidden = false;
    msg.style.color = '';
    msg.textContent = err.message;
  }
});

function renderProfile() {
  const c = Store.getCustomer();
  if (!c) return;
  $('#profileName').textContent  = c.name || 'Customer';
  $('#profileEmail').textContent = c.email || '';
  const perks = Store.getPerks();
  $('#profilePoints').textContent = perks.points;

  // Membership tier (by lifetime spend) + progress to the next one.
  const tier = Store.tierStatus();
  $('#profileTierBadge').textContent = `🏅 ${tier.name}`;
  $('#profileTierSpend').textContent = `${peso(tier.spend)} lifetime`;
  $('#tierFill').style.width = `${Math.round(tier.progress * 100)}%`;
  $('#profileTierNext').textContent = tier.next
    ? `Spend ${peso(tier.remaining)} more to reach ${tier.next}`
    : `🎉 You're at the top tier!`;

  const loy = Store.loyaltyStatus();
  $('#loyaltyText').textContent = `${loy.progress} / ${loy.goal}`;
  $('#loyaltyFill').style.width = `${Math.round((loy.progress / loy.goal) * 100)}%`;
  const earnedEl = $('#loyaltyEarned');
  if (loy.earned > 0) {
    earnedEl.hidden = false;
    earnedEl.textContent = `🎉 ${loy.earned} free muffin${loy.earned === 1 ? '' : 's'} earned — show staff to claim.`;
  } else {
    earnedEl.hidden = true;
  }

  const redeemBtn = $('#redeemVoucherBtn');
  redeemBtn.disabled    = perks.points < Store.VOUCHER_COST;
  redeemBtn.textContent = `Redeem ${Store.VOUCHER_COST} pts → discount voucher`;

  const list = $('#voucherList');
  list.innerHTML = '';
  if (!perks.vouchers.length) {
    list.innerHTML = '<p class="muted small">No vouchers yet — redeem points to create one.</p>';
  } else {
    perks.vouchers.forEach(v => {
      const div = document.createElement('div');
      div.className = 'voucher-item' + (v.used ? ' used' : '');
      div.innerHTML = `<span class="voucher-code">${escapeHtml(v.code)}</span><span>${v.discountPct}% off</span>`;
      list.appendChild(div);
    });
  }
}

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
  if (!verified || verified.role !== 'admin' || !Store.isAdmin()) {
    console.warn('[admin] entry blocked — no valid admin session');
    return false;
  }
  // Caller's session object might be stale; prefer the verified
  // one for the displayed name.
  session = verified;
  adminPanel.hidden = false;
  $('#adminUserName').textContent = session.name || session.email;
  // Restore the last admin tab across refreshes (falls back to Orders).
  let startTab = 'orders';
  try {
    const saved = localStorage.getItem(ADMIN_TAB_KEY);
    if (['orders', 'chats', 'menu', 'settings'].includes(saved)) startTab = saved;
  } catch (e) {}
  switchAdminTab(startTab);
  renderOrders();
  loadSettingsForm();
  refreshAdminHeaderBtn();
  refreshAdminActivity();
  // Seed the Chats unread badge so it's accurate before the admin
  // ever opens the Chats tab.
  renderChatThreads();
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
  // Don't strand a docked chat inside the closing panel.
  if (chatDrawer.classList.contains('docked')) closeChat();
  adminPanel.hidden = true;
  refreshAdminHeaderBtn();
  document.body.classList.remove('admin-open');
}
function adminSignOut() {
  Store.logout();
  exitAdminPanel();
  refreshAdminHeaderBtn();
  // Clear the device's guest visit and drop back to the customer view.
  // Orders placed stay in the store; the session model needs no table
  // prompt — a fresh session is created on the next interaction.
  resetCustomerVisitState();
  showToast('Signed out');
}
$('#exitAdminBtn').addEventListener('click', exitAdminPanel);
$('#adminLogoutBtn').addEventListener('click', adminSignOut);

function switchAdminTab(tab) {
  // Leaving Chats with a docked conversation open → close it so the
  // drawer node isn't left inside a hidden pane. Also drop select mode.
  if (tab !== 'chats') {
    if (chatDrawer.classList.contains('docked')) closeChat();
    if (chatSelectMode) exitChatSelect();
  }
  $$('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.adminTab === tab));
  $$('.admin-pane').forEach(p => p.hidden = (p.dataset.adminPane !== tab));
  const menuFilter = $('#menuCatFilter');
  if (menuFilter) menuFilter.hidden = (tab !== 'menu');
  if (tab === 'orders')   renderOrders();
  if (tab === 'chats')    renderChatThreads();
  if (tab === 'menu')   { renderMenuCatFilter(); renderMenuTable(); }
  if (tab === 'settings') loadSettingsForm();
  // Remember the tab so a refresh returns the admin to where they were.
  try { localStorage.setItem(ADMIN_TAB_KEY, tab); } catch (e) {}
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

/* Orders view: 'list' (classic) or 'board' (POS Kanban/KDS). Per-device. */
let ordersView = (localStorage.getItem('bb_orders_view') === 'board') ? 'board' : 'list';

/* Dispatcher — keeps every existing renderOrders() caller working while
   routing to whichever view the staff has selected on this device. */
function renderOrders() {
  if (ordersView === 'board') renderOrdersBoard();
  else                        renderOrdersList();
}

function renderOrdersList() {
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
    const locTag = o.locationIdentifier
      ? `<span class="table-tag" title="Location">
              <span class="table-tag-label">📍</span>
              <strong>${escapeHtml(String(o.locationIdentifier))}</strong>
            </span>`
      : '';
    const cancellable = Store.isCancellableByCustomer(o);
    return `
      <article class="order-card${orderSelectMode ? ' selectable' : ''}${selectedOrders.has(o.id) ? ' selected' : ''}" data-id="${o.id}" data-status="${o.status}">
        <header class="order-head">
          <div class="order-head-id">
            <h3>#${o.number}</h3>
            ${locTag}
          </div>
          <div class="order-head-status">
            <span class="status-pill status-${o.status}">${o.status}</span>
            ${cancellable
              ? `<span class="cancellable-badge" title="Customer can still cancel until you mark it preparing">
                   ⏱ cancellable
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
          <button class="btn btn-ghost" data-act="receipt">🧾 Receipt</button>
          <button class="btn btn-ghost" data-act="delete">Delete</button>
        </div>
      </article>
    `;
  }).join('');
  refreshOrdersBadge();
  refreshDayStats();
}

/* ==========================================================
   POS KANBAN / KDS BOARD  (toggleable Orders view)
   Three columns — Pending → Preparing → Ready(served) — with
   tap-to-advance and drag-to-advance. Cancelled orders never
   appear on the board (use List view's All/Served filter).
   ========================================================== */
const KDS_COLS = [
  { key: 'pending',   title: 'Pending',   advance: 'preparing', cta: 'Start ▶' },
  { key: 'preparing', title: 'Preparing', advance: 'served',    cta: 'Ready ✓' },
  { key: 'served',    title: 'Ready',     advance: null,        cta: null },
];
const KDS_WARN_MS = 5 * 60 * 1000;    // amber after 5 min waiting
const KDS_LATE_MS = 10 * 60 * 1000;   // red after 10 min waiting

/* Elapsed-time aging class (only meaningful while not yet served). */
function kdsAgeClass(o) {
  if (o.status === 'served') return '';
  const ms = Date.now() - new Date(o.placedAt).getTime();
  if (ms >= KDS_LATE_MS) return ' aging-late';
  if (ms >= KDS_WARN_MS) return ' aging-warn';
  return '';
}

function kdsTicketHtml(o, col) {
  const itemsHtml = o.items.map(i =>
    `<li><span>${i.qty}× ${escapeHtml(i.name)}${i.summary ? `<small> — ${escapeHtml(i.summary)}</small>` : ''}</span></li>`
  ).join('');
  const loc = o.locationIdentifier
    ? `<span class="kds-loc">📍 ${escapeHtml(String(o.locationIdentifier))}</span>` : '';
  const advanceBtn = col.advance
    ? `<button class="btn kds-advance ${col.advance === 'served' ? 'btn-serve' : 'btn-prep'}" data-act="${col.advance}">${col.cta}</button>`
    : '';
  const modifyBtn = o.status === 'pending'
    ? `<button class="kds-mini" data-act="modify" title="Modify" aria-label="Modify">✎</button>` : '';
  const cancelBtn = (o.status !== 'served' && o.status !== 'cancelled')
    ? `<button class="kds-mini kds-mini-danger" data-act="cancelled" title="Cancel" aria-label="Cancel">✕</button>` : '';
  const isNew = (o.status === 'pending') && (Date.now() - new Date(o.placedAt).getTime() < 12000);
  return `
    <article class="kds-ticket${kdsAgeClass(o)}${isNew ? ' kds-new' : ''}" data-id="${o.id}" data-status="${o.status}" draggable="false">
      <header class="kds-ticket-head">
        <span class="kds-num">#${o.number}</span>
        ${loc}
        <span class="kds-age" data-placed="${o.placedAt}">${timeAgo(new Date(o.placedAt))}</span>
      </header>
      <ul class="kds-items">${itemsHtml}</ul>
      <div class="kds-ticket-foot">
        <span class="kds-total">${peso(o.total)}</span>
        <div class="kds-actions">
          ${modifyBtn}
          <button class="kds-mini" data-act="receipt" title="Receipt" aria-label="Receipt">🧾</button>
          ${cancelBtn}
          <button class="kds-mini" data-act="delete" title="Delete" aria-label="Delete">🗑</button>
        </div>
      </div>
      ${advanceBtn}
    </article>`;
}

function renderOrdersBoard() {
  const host = $('#ordersBoard');
  const all = Store.getOrders();
  // Served column shows TODAY's served only (keeps "Ready" from growing
  // forever); pending/preparing show all that are active.
  const now = new Date();
  const isToday = (iso) => {
    const t = new Date(iso);
    return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate();
  };
  const byCol = (key) => all
    .filter(o => o.status === key && (key !== 'served' || isToday(o.servedAt || o.placedAt)))
    // FIFO: oldest first so the next ticket to work is at the top.
    .sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));

  host.innerHTML = KDS_COLS.map(col => {
    const list = byCol(col.key);
    const tickets = list.length
      ? list.map(o => kdsTicketHtml(o, col)).join('')
      : `<p class="kds-empty">—</p>`;
    return `
      <section class="kds-col" data-col="${col.key}" data-status="${col.key}">
        <header class="kds-col-head kds-col-${col.key}">
          <span>${col.title}</span>
          <span class="kds-count">${list.length}</span>
        </header>
        <div class="kds-col-body">${tickets}</div>
      </section>`;
  }).join('');
  refreshOrdersBadge();
  refreshDayStats();
}

/* Switch + persist the Orders view (per-device). Hides the status filter
   and the multi-select tools in board mode (columns ARE the statuses). */
function setOrdersView(v) {
  ordersView = (v === 'board') ? 'board' : 'list';
  try { localStorage.setItem('bb_orders_view', ordersView); } catch (_) {}
  const board = ordersView === 'board';
  $('#ordersList').hidden  = board;
  $('#ordersBoard').hidden = !board;
  // Status filter + select tools only make sense in the list view.
  const filter = $('#orderFilter'); if (filter) filter.hidden = board;
  const selToggle = $('#orderSelectToggle'); if (selToggle) selToggle.hidden = board;
  ['#ordersViewList', '#ordersViewBoard'].forEach(sel => {
    const btn = $(sel);
    if (!btn) return;
    const on = btn.dataset.view === ordersView;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  // Leaving board → make sure any select-mode leftovers don't linger.
  renderOrders();
}
$('#ordersViewList')?.addEventListener('click', () => setOrdersView('list'));
$('#ordersViewBoard')?.addEventListener('click', () => setOrdersView('board'));
// Sync the toggle + container visibility to the saved preference on load.
setOrdersView(ordersView);

$('#orderFilter').addEventListener('change', renderOrders);
$('#clearServedBtn').addEventListener('click', async () => {
  if (!(await confirmAsk('Clear all served orders?', {
    title: 'Clear served', confirmLabel: 'Clear served', danger: true,
  }))) return;
  Store.clearServedOrders();
  renderOrders();
});

/* Shared order-action runner — used by BOTH the list view and the KDS
   board (tickets carry the same data-act buttons). Reads the order id
   from the nearest [data-id] so it works for .order-card and .kds-ticket. */
async function performOrderAction(btn) {
  const card = btn.closest('[data-id]');
  if (!card) return;
  const id = card.dataset.id;
  const act = btn.dataset.act;
  const order = Store.getOrders().find(o => o.id === id);
  const label = order ? `#${order.number}` : 'Order';
  if (act === 'receipt') { if (order) openReceiptModal(order); return; }
  if (act === 'modify')  { if (order) openAdminEditOrder(order); return; }
  if (act === 'delete') {
    if (!(await confirmAsk('Delete this order?', {
      title: 'Delete order', confirmLabel: 'Delete', danger: true,
    }))) return;
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
}

$('#ordersList').addEventListener('click', async (e) => {
  // A long-press already handled this tap → swallow the click.
  if (suppressNextOrderClick) { suppressNextOrderClick = false; return; }
  // In select mode any tap on a card toggles its selection (no radios;
  // action buttons are inert while selecting).
  if (orderSelectMode) {
    const card = e.target.closest('.order-card');
    if (card) toggleOrderSelected(card);
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  await performOrderAction(btn);
});

/* Board: tickets use the same data-act buttons; no select mode here. */
$('#ordersBoard').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  await performOrderAction(btn);
});

/* ----- KDS board drag-and-drop -------------------------------------
   Drag a ticket into another column to set its status. Pointer-based so
   it works with touch + mouse; a short move threshold keeps it from
   hijacking vertical column scrolling, and starts on buttons are ignored
   so taps on Start/Ready/⋯ still work. Dropping on the same column (or
   nowhere) snaps back. */
(function wireKdsDragDrop() {
  const board = $('#ordersBoard');
  if (!board) return;
  const THRESHOLD = 8;                  // px before a press becomes a drag
  let ticket = null, id = null, fromStatus = null, pid = null;
  let startX = 0, startY = 0, decided = false, dragging = false;
  let clone = null, lastCol = null;

  const clearDropTargets = () => board.querySelectorAll('.kds-col.drop-target')
    .forEach(c => c.classList.remove('drop-target'));

  const cleanup = () => {
    if (clone) { clone.remove(); clone = null; }
    if (ticket) ticket.classList.remove('dragging');
    clearDropTargets();
    ticket = null; id = null; fromStatus = null; pid = null;
    decided = false; dragging = false; lastCol = null;
  };

  board.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('button, a, input, label')) return;   // let controls work
    const t = e.target.closest('.kds-ticket');
    if (!t) return;
    ticket = t; id = t.dataset.id; fromStatus = t.dataset.status;
    pid = e.pointerId; startX = e.clientX; startY = e.clientY;
    decided = false; dragging = false;
  });

  board.addEventListener('pointermove', (e) => {
    if (!ticket || e.pointerId !== pid) return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (!decided) {
      if (Math.abs(mx) < THRESHOLD && Math.abs(my) < THRESHOLD) return;
      decided = true;
      // Engage drag only when horizontal intent dominates; otherwise let
      // the column scroll vertically (release our tracking).
      if (Math.abs(mx) <= Math.abs(my)) { ticket = null; return; }
      dragging = true;
      try { board.setPointerCapture(pid); } catch (_) {}
      const r = ticket.getBoundingClientRect();
      clone = ticket.cloneNode(true);
      clone.classList.add('kds-drag-clone');
      clone.style.width = r.width + 'px';
      clone.style.left = r.left + 'px';
      clone.style.top = r.top + 'px';
      clone._dx = e.clientX - r.left;
      clone._dy = e.clientY - r.top;
      document.body.appendChild(clone);
      ticket.classList.add('dragging');
    }
    if (!dragging) return;
    e.preventDefault();
    clone.style.left = (e.clientX - clone._dx) + 'px';
    clone.style.top  = (e.clientY - clone._dy) + 'px';
    // Highlight the column under the pointer.
    clone.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const col = under && under.closest('.kds-col');
    if (col !== lastCol) { clearDropTargets(); if (col) col.classList.add('drop-target'); lastCol = col; }
  });

  const endDrag = (e) => {
    if (!ticket || (pid != null && e.pointerId !== pid)) return;
    const wasDragging = dragging, theId = id, from = fromStatus;
    let target = null;
    if (wasDragging) {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      target = under && under.closest('.kds-col');
    }
    try { if (pid != null) board.releasePointerCapture(pid); } catch (_) {}
    cleanup();
    if (!wasDragging || !target) return;
    const toStatus = target.dataset.status;
    if (!toStatus || toStatus === from) return;           // same column → no-op
    Store.updateOrderStatus(theId, toStatus);
    ORDER_STATUS_BY_ID.set(theId, toStatus);
    const ord = Store.getOrders().find(o => o.id === theId);
    showAdminToast({
      title: `#${ord ? ord.number : ''} → ${toStatus === 'served' ? 'ready' : toStatus}`,
      variant: toStatus === 'served' ? 'success' : 'info',
    });
    renderOrders();
    refreshAdminActivity();
  };
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', endDrag);
})();

/* Keep the board's elapsed timers + aging colours fresh while it's the
   active view and the panel is open (re-render is cheap and idempotent). */
setInterval(() => {
  if (ordersView !== 'board') return;
  if (!adminPanel || adminPanel.hidden) return;
  if ($('.admin-tab.active')?.dataset.adminTab !== 'orders') return;
  renderOrdersBoard();
}, 30 * 1000);

/* ----- Admin multi-select (orders): click-to-select + long-press,
   then Cancel or Delete the whole selection ----- */
let orderSelectMode = false;
const selectedOrders = new Set();
let suppressNextOrderClick = false;   // long-press already handled this tap

function updateOrdersSelectUI() {
  const toggle = $('#orderSelectToggle');
  if (toggle) toggle.textContent = orderSelectMode ? 'Cancel' : 'Select';
  const n = selectedOrders.size;
  const del = $('#deleteSelectedOrdersBtn');
  if (del) {
    del.hidden = !orderSelectMode;
    del.disabled = n === 0;
    del.textContent = n ? `Delete (${n})` : 'Delete';
  }
  const can = $('#cancelSelectedOrdersBtn');
  if (can) {
    can.hidden = !orderSelectMode;
    can.disabled = n === 0;
    can.textContent = n ? `Cancel orders (${n})` : 'Cancel orders';
  }
  const all = $('#orderSelectAllBtn');
  if (all) {
    all.hidden = !orderSelectMode;
    // "All" = every currently-RENDERED (i.e. filtered) card; cards
    // hidden by the filter are intentionally excluded.
    const cards = [...document.querySelectorAll('#ordersList .order-card')];
    const allSel = cards.length > 0 && cards.every(c => selectedOrders.has(c.dataset.id));
    all.textContent = allSel ? 'Deselect all' : 'Select all';
  }
}
function toggleOrderSelected(card) {
  const id = card.dataset.id;
  if (selectedOrders.has(id)) { selectedOrders.delete(id); card.classList.remove('selected'); }
  else                        { selectedOrders.add(id);    card.classList.add('selected'); }
  updateOrdersSelectUI();
}
function enterOrderSelect() {
  orderSelectMode = true;
  selectedOrders.clear();
  renderOrders();
  updateOrdersSelectUI();
}
function exitOrderSelect() {
  orderSelectMode = false;
  selectedOrders.clear();
  renderOrders();
  updateOrdersSelectUI();
}
$('#orderSelectToggle').addEventListener('click', () => {
  if (orderSelectMode) exitOrderSelect(); else enterOrderSelect();
});
/* Select all toggles the CURRENTLY FILTERED cards only (the dropdown
   filter decides which are rendered; anything outside it is left
   untouched). */
$('#orderSelectAllBtn').addEventListener('click', () => {
  const cards = [...document.querySelectorAll('#ordersList .order-card')];
  if (!cards.length) return;
  const allSel = cards.every(c => selectedOrders.has(c.dataset.id));
  cards.forEach(c => {
    if (allSel) { selectedOrders.delete(c.dataset.id); c.classList.remove('selected'); }
    else        { selectedOrders.add(c.dataset.id);    c.classList.add('selected'); }
  });
  updateOrdersSelectUI();
});

/* Long-press (hold) any order to enter select mode and pick it. */
(function wireOrderLongPress() {
  const host = $('#ordersList');
  if (!host) return;
  let timer = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  host.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.order-card');
    if (!card) return;
    const id = card.dataset.id;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      suppressNextOrderClick = true;
      if (!orderSelectMode) enterOrderSelect();   // re-renders the list
      const fresh = host.querySelector(`.order-card[data-id="${id}"]`);
      if (fresh) toggleOrderSelected(fresh);
    }, 500);
  });
  ['pointerup', 'pointerleave', 'pointercancel', 'pointermove', 'scroll']
    .forEach(ev => host.addEventListener(ev, cancel, { passive: true }));
})();

$('#deleteSelectedOrdersBtn').addEventListener('click', async () => {
  const ids = [...selectedOrders];
  if (!ids.length) { showAdminToast({ title: 'No orders selected', variant: 'info' }); return; }
  if (!(await confirmAsk(`Delete ${ids.length} selected order${ids.length === 1 ? '' : 's'}? This removes them entirely.`, {
    title: 'Delete orders', confirmLabel: 'Delete', danger: true,
  }))) return;
  ids.forEach(id => {
    Store.deleteOrder(id);
    knownOrderIds.delete(id);
    ORDER_STATUS_BY_ID.delete(id);
  });
  exitOrderSelect();
  showAdminToast({ title: `Deleted ${ids.length} order${ids.length === 1 ? '' : 's'}`, variant: 'danger' });
  refreshAdminActivity();
});
$('#cancelSelectedOrdersBtn').addEventListener('click', async () => {
  const ids = [...selectedOrders];
  if (!ids.length) { showAdminToast({ title: 'No orders selected', variant: 'info' }); return; }
  if (!(await confirmAsk(`Cancel ${ids.length} selected order${ids.length === 1 ? '' : 's'}? They stay in the list marked cancelled.`, {
    title: 'Cancel orders', confirmLabel: 'Cancel orders', cancelLabel: 'Keep them', danger: true,
  }))) return;
  let n = 0;
  ids.forEach(id => {
    Store.updateOrderStatus(id, 'cancelled');
    ORDER_STATUS_BY_ID.set(id, 'cancelled');
    n++;
  });
  exitOrderSelect();
  showAdminToast({ title: `Cancelled ${n} order${n === 1 ? '' : 's'}`, variant: 'danger' });
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
  if (chip.dataset.cat === adminMenuCategory) return;     // no-op, no reflow
  adminMenuCategory = chip.dataset.cat;
  // Anchor the admin scroll box so filtering doesn't jump the list.
  withScrollAnchor($('.admin-content'), () => { renderMenuCatFilter(); renderMenuTable(); });
});
$('#menuGroupToggle').addEventListener('change', (e) => {
  menuGroupBy = e.target.checked;
  withScrollAnchor($('.admin-content'), renderMenuTable);
});
$('#menuTable').querySelector('thead').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const key = th.dataset.sort;
  if (menuSort.key === key) menuSort.dir = (menuSort.dir === 'asc') ? 'desc' : 'asc';
  else { menuSort.key = key; menuSort.dir = 'asc'; }
  withScrollAnchor($('.admin-content'), renderMenuTable);
});
$('#addCategoryBtn').addEventListener('click', async () => {
  const label = await uiPrompt({
    title: 'New category',
    message: 'Name the new menu category.',
    placeholder: 'e.g. Smoothies, Sandwiches',
    confirmLabel: 'Add category',
  });
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
$('#deleteSelectedMenuBtn').addEventListener('click', async () => {
  if (!selectedMenu.size) { showAdminToast({ title: 'No items selected', variant: 'info' }); return; }
  if (!(await confirmAsk(`Delete ${selectedMenu.size} selected item${selectedMenu.size === 1 ? '' : 's'}?`, {
    title: 'Delete items', confirmLabel: 'Delete', danger: true,
  }))) return;
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
$('#menuTableBody').addEventListener('click', async (e) => {
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
    if (!(await confirmAsk(`Delete "${item.name}"?`, {
      title: 'Delete item', confirmLabel: 'Delete', danger: true,
    }))) return;
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
$('#itemCategorySelect').addEventListener('change', async (e) => {
  const sel = e.target;
  if (sel.value !== NEW_CATEGORY_SENTINEL) { sel.dataset.prev = sel.value; return; }
  // Revert the select immediately so the "+ New category…" sentinel isn't
  // left showing while the (async) prompt is open.
  sel.value = sel.dataset.prev || '';
  const label = await uiPrompt({
    title: 'New category',
    message: 'Name the new menu category.',
    placeholder: 'e.g. Smoothies, Sandwiches',
    confirmLabel: 'Add category',
  });
  if (!label) return;                          // cancelled — keep previous
  const { category, created } = Store.addCategory(label);
  if (!category) return;
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
$('#rotateInviteBtn')?.addEventListener('click', async () => {
  if (!(await confirmAsk('Rotate the invite code? Any pending invite links using the old code will stop working.', {
    title: 'Rotate invite code', confirmLabel: 'Rotate', danger: true,
  }))) return;
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
  patch.taxInclusive   = f.elements.taxInclusive?.checked || false;
  patch.allowGuestChat = f.elements.allowGuestChat?.checked || false;
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

$('#resetMenuBtn').addEventListener('click', async () => {
  if (!(await confirmAsk('Reset menu to defaults? Custom items will be lost.', {
    title: 'Reset menu', confirmLabel: 'Reset menu', danger: true,
  }))) return;
  Store.resetMenu();
  MENU = Store.getMenu();
  renderMenuTable();
  renderMenu();
  showToast('Menu reset');
});
$('#factoryResetBtn').addEventListener('click', async () => {
  if (!(await confirmAsk('Factory reset wipes everything (menu, orders, settings, sign-in). Continue?', {
    title: 'Factory reset', confirmLabel: 'Reset everything', cancelLabel: 'Keep my data', danger: true, dismissable: false,
  }))) return;
  Store.factoryReset();
  showToast('Reset complete');
  setTimeout(() => location.reload(), 600);
});
$('#resetEverythingBtn').addEventListener('click', async () => {
  if (!(await confirmAsk('Reset EVERYTHING to default? This clears all orders, chat, activity, sessions, accounts, menu and settings on the cloud AND this device. This affects every device and cannot be undone.', {
    title: 'Reset everything', confirmLabel: 'Continue', cancelLabel: 'Keep my data', danger: true, dismissable: false,
  }))) return;
  // Type-to-confirm for a destructive, cross-device wipe.
  const typed = await uiPrompt({
    title: 'Confirm full wipe',
    message: 'Type RESET to confirm clearing everything on the cloud and this device.',
    placeholder: 'RESET',
    confirmLabel: 'Wipe everything',
    cancelLabel: 'Cancel',
    dismissable: false,
    validate: (v) => v.toUpperCase() === 'RESET' ? null : 'Type RESET (in capitals) to proceed.',
  });
  if (typed === null) { showAdminToast({ title: 'Reset cancelled', variant: 'info' }); return; }
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
$('#clearLogBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!(await confirmAsk('Clear activity log?', {
    title: 'Clear activity', confirmLabel: 'Clear', danger: true,
  }))) return;
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
  $('#sendReceiptBtn').dataset.orderId        = order.id;
  $('#downloadReceiptBtn').dataset.orderId    = order.id;
  $('#downloadReceiptPngBtn').dataset.orderId = order.id;
  $('#printReceiptBtn').dataset.orderId       = order.id;
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
      ${order.locationIdentifier ? `<div class="rec-row"><span>Location</span><strong>${escapeHtml(String(order.locationIdentifier))}</strong></div>` : ''}
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
      * { box-sizing: border-box; }
      body { font-family: 'Courier New', ui-monospace, Menlo, Consolas, monospace;
             color: #1c1712; margin: 0; padding: 18px; background: #fff; }
      .receipt { width: 300px; margin: 0 auto; font-size: 12px; line-height: 1.55; }
      header { text-align: center; margin-bottom: 8px; }
      header strong { display: block; font-size: 16px; letter-spacing: .5px; }
      header small  { display: block; color: #555; font-size: 10.5px; }
      hr { border: none; border-top: 1px dashed #9a8a6a; margin: 9px 0; }
      .rec-row, .rec-line { display: flex; justify-content: space-between; gap: 10px; }
      .rec-line { margin-bottom: 3px; }
      .rec-line-name { flex: 1; }
      .rec-line-name small { display: block; color: #7a6e5d; font-style: italic; font-size: 10px; }
      .rec-line-price { white-space: nowrap; }
      .rec-row.total { font-size: 15px; font-weight: 700;
                       border-top: 2px solid #333; margin-top: 4px; padding-top: 6px; }
      .rec-thanks { text-align: center; margin: 12px 0 0; color: #555; }
      @page { margin: 8mm; }
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
    o.locationIdentifier ? `Location: ${o.locationIdentifier}` : '',
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
   RECEIPT → PNG  (no library, no print dialog, no external app)
   Draws the receipt straight onto a <canvas> with the 2D API and
   exports it via canvas.toBlob('image/png'). This sidesteps the
   browser print path entirely (and any "open with .exe" / PDF
   handler issues) — the customer just gets an image file.
   ========================================================== */
function drawReceiptToCanvas(order) {
  const DPR  = 3;                         // crisp on retina / when zoomed
  const W    = 340;                       // logical receipt width (px)
  const PAD  = 22;
  const contentW = W - PAD * 2;
  const mono = "'Courier New', ui-monospace, Consolas, monospace";
  const INK = '#1c1712', SOFT = '#7a6e5d', RULE = '#b9a77f', BG = '#FFFBF5';

  // Measuring context for word-wrap (sized later for the real draw).
  const mctx = document.createElement('canvas').getContext('2d');
  const wrapText = (text, font, maxW) => {
    mctx.font = font;
    const words = String(text).split(/\s+/).filter(Boolean);
    const out = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (line && mctx.measureText(test).width > maxW) { out.push(line); line = w; }
      else line = test;
    }
    if (line) out.push(line);
    return out.length ? out : [''];
  };

  // ---- Pass 1: build an ops list and compute total height -------
  const ops = [];
  let y = PAD;
  const center = (text, font, color, lh) => { ops.push({ t: 'c', text, font, color, y: y + lh * 0.78 }); y += lh; };
  const rowOp  = (l, r, font, color, lh) => { ops.push({ t: 'r', l, r, font, color, y: y + lh * 0.78 }); y += lh; };
  const dash   = () => { y += 7; ops.push({ t: 'd', y }); y += 9; };
  const solid  = () => { y += 7; ops.push({ t: 's', y }); y += 9; };

  const fName  = `bold 17px ${mono}`;
  const fSmall = `11px ${mono}`;
  const fMeta  = `12.5px ${mono}`;
  const fItem  = `12.5px ${mono}`;
  const fTotal = `bold 15px ${mono}`;

  const { subtotal, tax, grand } = taxBreakdown(order.total);
  const taxLabel = CONFIG.taxLabel || 'Tax';
  const taxRate  = Number(CONFIG.taxRate || 0);

  center(CONFIG.businessName || CONFIG.shopName || 'Receipt', fName, INK, 22);
  if (CONFIG.businessAddr) wrapText(CONFIG.businessAddr, fSmall, contentW).forEach(l => center(l, fSmall, SOFT, 14));
  if (CONFIG.businessTin)  center('TIN: ' + CONFIG.businessTin, fSmall, SOFT, 14);
  dash();
  rowOp('Order', '#' + order.number, fMeta, INK, 17);
  if (order.locationIdentifier) rowOp('Location', String(order.locationIdentifier), fMeta, INK, 17);
  rowOp('Placed', new Date(order.placedAt).toLocaleString(), fMeta, INK, 17);
  if (order.servedAt) rowOp('Served', new Date(order.servedAt).toLocaleString(), fMeta, INK, 17);
  dash();
  order.items.forEach(i => {
    const price = peso(i.unitPrice * i.qty);
    const nameLines = wrapText(`${i.qty} × ${i.name}`, fItem, contentW - 70);
    nameLines.forEach((ln, idx) => rowOp(ln, idx === 0 ? price : '', fItem, INK, 16));
    if (i.summary) wrapText(i.summary, fSmall, contentW - 12).forEach(s => rowOp('  ' + s, '', fSmall, SOFT, 14));
  });
  dash();
  rowOp('Subtotal', peso(subtotal), fMeta, INK, 17);
  rowOp(`${taxLabel} (${taxRate}%${CONFIG.taxInclusive ? ', incl.' : ''})`, peso(tax), fMeta, INK, 17);
  solid();
  rowOp('TOTAL', peso(grand), fTotal, INK, 22);
  dash();
  center('Thank you ☕', fMeta, SOFT, 18);
  const H = y + PAD;

  // ---- Pass 2: render -------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  for (const op of ops) {
    if (op.t === 'c') {
      ctx.font = op.font; ctx.fillStyle = op.color; ctx.textAlign = 'center';
      ctx.fillText(op.text, W / 2, op.y);
    } else if (op.t === 'r') {
      ctx.font = op.font; ctx.fillStyle = op.color;
      ctx.textAlign = 'left';  ctx.fillText(op.l, PAD, op.y);
      if (op.r) { ctx.textAlign = 'right'; ctx.fillText(op.r, W - PAD, op.y); }
    } else if (op.t === 'd' || op.t === 's') {
      ctx.strokeStyle = op.t === 'd' ? RULE : '#333';
      ctx.lineWidth = op.t === 'd' ? 1 : 1.5;
      ctx.setLineDash(op.t === 'd' ? [3, 3] : []);
      ctx.beginPath(); ctx.moveTo(PAD, op.y); ctx.lineTo(W - PAD, op.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  return canvas;
}

$('#downloadReceiptPngBtn').addEventListener('click', () => {
  const id = $('#downloadReceiptPngBtn').dataset.orderId;
  const o  = Store.getOrders().find(x => x.id === id);
  if (!o) return;
  try {
    const canvas = drawReceiptToCanvas(o);
    canvas.toBlob((blob) => {
      if (!blob) { showAdminToast({ title: 'Could not render image', variant: 'danger' }); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `receipt-${o.number}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showAdminToast({ title: `Receipt #${o.number} saved as image`, variant: 'success' });
    }, 'image/png');
  } catch (err) {
    showAdminToast({ title: `Image export failed: ${err.message || err}`, variant: 'danger' });
  }
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

  const cur = CONFIG.currency || '';
  const headers = [
    'Order #', 'Location', 'Placed', 'Served', 'Status',
    'Items', 'Qty',
    `Subtotal (${cur})`, `${CONFIG.taxLabel || 'Tax'} ${CONFIG.taxRate}% (${cur})`, `Total (${cur})`,
  ];

  const dataRows = todays.map(o => {
    const { subtotal, tax, grand } = taxBreakdown(o.total);
    const itemsSummary = o.items
      .map(i => `${i.qty}× ${i.name}${i.summary ? ' (' + i.summary + ')' : ''}`)
      .join('; ');
    const qtyTotal = o.items.reduce((s, i) => s + i.qty, 0);
    return [
      o.number,
      o.locationIdentifier || '',
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
  // two-column header table (label | value) rather than dumping
  // everything into column A.
  const servedToday = todays.filter(o => o.status === 'served');
  const grossAll    = todays.reduce((s, o) => s + taxBreakdown(o.total).grand, 0);
  const grossServed = servedToday.reduce((s, o) => s + taxBreakdown(o.total).grand, 0);

  lines.push([`${CONFIG.businessName || CONFIG.shopName} — Daily Sales Report`].map(csvEscape).join(','));
  lines.push(['Generated',       fmtDate(now.toISOString())].map(csvEscape).join(','));
  lines.push(['Currency',        cur].map(csvEscape).join(','));
  lines.push(['Tax',             `${CONFIG.taxLabel} ${CONFIG.taxRate}% (${CONFIG.taxInclusive ? 'inclusive' : 'exclusive'})`].map(csvEscape).join(','));
  lines.push(['Orders today',    todays.length].map(csvEscape).join(','));
  lines.push(['Served today',    servedToday.length].map(csvEscape).join(','));
  lines.push([`Gross all (${cur})`,    Number(grossAll.toFixed(2))].map(csvEscape).join(','));
  lines.push([`Gross served (${cur})`, Number(grossServed.toFixed(2))].map(csvEscape).join(','));
  lines.push(['Lifetime orders', (CONFIG.lifetimeOrders || 0)].map(csvEscape).join(','));
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
    lines.push(['TOTALS'].map(csvEscape).join(','));
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
    lines.push([
      '', '', '', '', 'AVG / ORDER', '', '', '', '',
      formula(`=IFERROR(SUM(${rng(colTotal)})/COUNT(${rng(colTotal)}),0)`),
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
  triggerDownload(`orderinn-daily-${stamp}.csv`, csv, 'text/csv');
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
    // Unlock autoplay SILENTLY — play muted, then reset. Without muting,
    // the first click/keypress after a reload audibly plays a clipped
    // fragment of the notif sound (the "cut in the middle" on reload).
    notifAudio.muted = true;
    notifAudio.play().then(() => {
      notifAudio.pause();
      notifAudio.currentTime = 0;
      notifAudio.muted = false;
      notifAudioUnlocked = true;
    }).catch(() => { notifAudio.muted = false; });
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

/* Credit points for any of THIS customer's orders that are already
   completed but not yet awarded — covers orders served while their
   tab was closed (the live award in reactToCustomerOrderChanges only
   fires on a status transition this device actually observes).
   Idempotent via Store.awardOrderPoints. */
function reconcileCustomerPoints() {
  if (!(Store.isCustomer && Store.isCustomer())) return 0;
  let total = 0;
  for (const o of Store.getMyOrders()) {
    if (o.status === 'served') total += Store.awardOrderPoints(o);
  }
  if (total > 0 && !adminPanelOpenForToasts()) {
    showToast(`+${total} points from completed orders`, 'success');
  }
  return total;
}

/* Detects status changes for THIS customer's orders since the
   last snapshot and shows a friendly toast. Skipped silently
   when the admin panel is open (per the requested rule). */
function reactToCustomerOrderChanges() {
  const fresh = Store.getMyOrders();
  for (const o of fresh) {
    const prev = ORDER_STATUS_BY_ID.get(o.id);
    if (prev !== undefined && prev !== o.status) {
      // Loyalty: award points the moment THIS customer's order is
      // completed (served) — once per order, never at placement.
      if (o.status === 'served' && Store.isCustomer && Store.isCustomer()) {
        const earned = Store.awardOrderPoints(o);
        if (earned > 0 && !adminPanelOpenForToasts()) {
          showToast(`+${earned} points earned!`, 'success');
        }
      }
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
      title:   `🧾 New order #${o.number}${o.locationIdentifier ? ' · ' + o.locationIdentifier : ''}`,
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
/* Mark a thread read. Store a value at least as large as the newest
   message seen (server clock) AND local now, so a server/device clock
   skew can't leave a just-opened thread stuck "unread". */
function markChatSeen(thread, ts) {
  if (!thread) return;
  const map = chatSeenMap();
  map[thread] = Math.max(map[thread] || 0, ts || 0, Date.now());
  localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(map));
}
function latestChatTs() {
  return chatMessages.reduce((mx, m) => Math.max(mx, new Date(m.ts).getTime() || 0), 0) || Date.now();
}

/* Per-thread floor: the customer view hides messages older than this so
   a new guest reusing a table label starts with a clean conversation,
   while the messages themselves stay in the store for the admin. */
const CHAT_FLOOR_KEY = 'bb_chat_floor';
function chatFloorMap() { try { return JSON.parse(localStorage.getItem(CHAT_FLOOR_KEY) || '{}'); } catch { return {}; } }
function setChatFloor(thread, ts) {
  if (!thread) return;
  const map = chatFloorMap();
  map[thread] = Math.max(map[thread] || 0, ts || Date.now());
  localStorage.setItem(CHAT_FLOOR_KEY, JSON.stringify(map));
}

async function openChat(thread, role = 'customer') {
  if (!thread) return;                  // no session id yet
  // Customers can only chat once their session actually has an order —
  // no point messaging staff before ordering. (Admins always can.)
  if (role !== 'admin' && Store.getMyOrders().length === 0) {
    showToast('Place an order first to chat with staff', 'error');
    return;
  }
  chatThread = thread;
  chatRole   = role;
  // Admin opened this table's thread → mark it active + clear its
  // unread cue, in place (no list rebuild / "Loading…" flash).
  if (role === 'admin') {
    activeChatThread = thread;
    if (adminUnreadThreads.delete(String(thread))) updateChatsBadge();
    markThreadActiveInList(thread);
  }
  // Admin: title is the customer's name (from the cached thread list),
  // not "Table X". Falls back to the raw label if no name yet.
  const cacheName = (chatThreadsCache || []).find(t => String(t.thread) === String(thread))?.name;
  $('#chatTitle').textContent    = role === 'admin' ? (cacheName || String(thread)) : 'Chat with staff';
  updateChatStatus();              // sets the default subtitle
  startChatPresence(thread, role);
  chatDrawer.classList.add('open');
  chatDrawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('chat-open');
  // Desktop admin Chats tab → dock the drawer into the right pane
  // (two-pane layout). Everywhere else it floats as the sheet/side
  // drawer. Done before the await so the outside-close guard sees the
  // 'docked' class on this same click.
  if (role === 'admin' && chatShouldDock()) dockChat(); else undockChat();
  $('#chatBody').innerHTML = `<p class="empty-state">Loading…</p>`;
  chatMessages = await Store.listMessages(thread);
  setChatReply(null);
  renderChatMessages();
  markChatSeen(thread, latestChatTs());
  // Admin: now that we've marked it read, repaint the list so its
  // unread cue actually clears (it was re-seeding from the stale ts).
  if (role === 'admin' && chatThreadsCache) paintChatThreads(chatThreadsCache);
  refreshChatDot();
  syncChatToViewport(true);
}
function closeChat() {
  const wasDocked = chatDrawer.classList.contains('docked');
  chatDrawer.classList.remove('open');
  chatDrawer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('chat-open');
  setChatReply(null);
  stopChatPresence();
  if (activeVoiceId) { const a = voiceAudioEls.get(activeVoiceId); if (a) a.pause(); }
  syncChatToViewport(false);          // revert any keyboard sizing
  if (chatThread) markChatSeen(chatThread, latestChatTs());
  // Closing a docked conversation deselects it and returns the right
  // pane to its placeholder, then refreshes the list (read state).
  if (wasDocked) {
    undockChat();
    chatThread = null;
    activeChatThread = null;
    markThreadActiveInList(null);   // clear selection highlight in place
  }
  refreshChatDot();
}
$('#closeChatBtn').addEventListener('click', closeChat);
$('#fabChatBtn').addEventListener('click', () => openChat(state.tableNumber, 'customer'));

/* ----- Admin Messenger-style conversation list -------------------
   Replaces the old per-order "Chat" button. Lists every table that
   has messaged, newest first, with a last-message preview and an
   unread cue. Selecting a row opens that table's thread in the
   shared chat drawer. */
function updateChatsBadge() {
  const badge = $('#chatsBadge');
  if (!badge) return;
  const n = adminUnreadThreads.size;
  badge.textContent = n;
  badge.hidden = n === 0;
}
/* Two-pane docking: on a wide screen, while the admin is on the Chats
   tab, the conversation lives inline in the right pane instead of as a
   floating drawer. We physically move the existing #chatDrawer node so
   all its wiring (send/voice/image/reply/presence) is reused as-is. */
function chatShouldDock() {
  return window.innerWidth >= 800
    && Store.isAdmin()
    && adminPanel && !adminPanel.hidden
    && $('.admin-tab.active')?.dataset.adminTab === 'chats';
}
function dockChat() {
  const area = $('#chatDockArea');
  if (!area) return;
  if (chatDrawer.parentElement !== area) area.appendChild(chatDrawer);
  chatDrawer.classList.add('docked');
  area.classList.add('has-convo');
}
function undockChat() {
  chatDrawer.classList.remove('docked');
  const area = $('#chatDockArea');
  if (area) area.classList.remove('has-convo');
  if (chatDrawer.parentElement !== document.body) document.body.appendChild(chatDrawer);
}
// Re-evaluate docking when the viewport crosses the desktop/mobile line
// while a conversation is open (e.g. rotating a tablet).
window.addEventListener('resize', () => {
  if (!chatDrawer.classList.contains('open')) return;
  if (chatShouldDock()) dockChat();
  else if (chatDrawer.classList.contains('docked')) undockChat();
});
/* Lightweight "state" for the conversation list: we keep the last
   fetched threads in memory and the currently-open thread, so a
   re-render paints instantly from cache instead of flashing "Loading…"
   and re-fetching on every click. */
let chatThreadsCache = null;   // last fetched [{ thread, last, count }]
let activeChatThread = null;   // thread currently shown in the right pane
let chatSelectMode = false;    // admin multi-select (delete) mode
const selectedThreads = new Set();   // thread labels marked for deletion
let suppressNextChatClick = false;   // long-press already handled this tap

function paintChatThreads(threads) {
  const host = $('#chatThreadList');
  if (!host) return;
  // Seed unread from the seen-map so unread state survives a reload
  // (adminUnreadThreads alone only tracks messages seen live this
  // session). A thread is unread if its latest message is from a
  // customer and is newer than the last time the admin opened it.
  const seen = chatSeenMap();
  threads.forEach(t => {
    const m = t.last;
    if (m.role === 'customer' && new Date(m.ts).getTime() > (seen[t.thread] || 0)) {
      adminUnreadThreads.add(String(t.thread));
    }
  });
  if (!threads.length) {
    host.innerHTML = `<p class="empty-state">No conversations yet.</p>`;
    host.classList.remove('selecting');
    updateChatsBadge();
    return;
  }
  host.classList.toggle('selecting', chatSelectMode);
  host.innerHTML = threads.map(t => {
    const m = t.last;
    const unread = adminUnreadThreads.has(String(t.thread));
    const active = !chatSelectMode && String(activeChatThread) === String(t.thread);
    const sel = selectedThreads.has(String(t.thread));
    const preview = m.kind === 'image' ? '📷 Photo'
                  : m.kind === 'audio' ? '🎤 Voice message'
                  : escapeHtml(m.body || '');
    const who = m.role === 'admin' ? 'You: ' : '';
    const label = escapeHtml(String(t.thread));
    // Show the customer's name (per-person colour), not "Table X".
    const display = t.name || String(t.thread);
    const color = colorForName(display);
    return `
      <button class="chat-thread${unread ? ' unread' : ''}${active ? ' active' : ''}${sel ? ' selected' : ''}" data-thread="${label}">
        <span class="ct-avatar" style="background:${color}">${escapeHtml(initialsForName(display))}</span>
        <span class="ct-main">
          <span class="ct-top">
            <strong class="ct-name">${escapeHtml(display)}</strong>
            <small class="ct-time">${timeAgo(new Date(m.ts))}</small>
          </span>
          <span class="ct-preview">${who}${preview}</span>
        </span>
        ${unread ? '<span class="ct-dot" aria-label="unread"></span>' : ''}
      </button>`;
  }).join('');
  updateChatsBadge();
}

/* Fetch threads from the store. Only shows "Loading…" on the very first
   load (empty cache); afterwards it repaints in place, so opening a
   conversation never flashes or reloads the list. */
async function loadChatThreads() {
  const host = $('#chatThreadList');
  if (!host) return;
  if (!chatThreadsCache) host.innerHTML = `<p class="empty-state">Loading…</p>`;
  let threads = [];
  try { threads = await Store.listThreads(); } catch (e) { threads = []; }
  chatThreadsCache = threads;
  paintChatThreads(threads);
}

/* Entry point: paint instantly from cache (no flicker) then refresh in
   the background. */
function renderChatThreads() {
  if (chatThreadsCache) paintChatThreads(chatThreadsCache);
  loadChatThreads();
}

/* Mark one row selected + read directly in the DOM — no list rebuild,
   so selecting a conversation stays snappy and flicker-free. */
function markThreadActiveInList(thread) {
  const host = $('#chatThreadList');
  if (!host) return;
  host.querySelectorAll('.chat-thread').forEach(row => {
    const isThis = String(row.dataset.thread) === String(thread);
    row.classList.toggle('active', isThis);
    if (isThis) {
      row.classList.remove('unread');
      row.querySelector('.ct-dot')?.remove();
    }
  });
}

/* ----- Multi-select + delete for conversations -----
   Click a row in select mode to toggle it (no radio buttons); a
   long-press on any row also drops into select mode and picks it. */
function toggleThreadSelected(row) {
  const t = String(row.dataset.thread);
  if (selectedThreads.has(t)) { selectedThreads.delete(t); row.classList.remove('selected'); }
  else                        { selectedThreads.add(t);    row.classList.add('selected'); }
  updateChatSelectBar();
}
function updateChatSelectBar() {
  const bar = $('#chatSelectBar');
  if (bar) bar.hidden = !chatSelectMode;
  const count = $('#chatSelectCount');
  if (count) count.textContent = `${selectedThreads.size} selected`;
  const del = $('#chatDeleteSelected');
  if (del) del.disabled = selectedThreads.size === 0;
  const toggle = $('#chatSelectToggle');
  if (toggle) toggle.textContent = chatSelectMode ? 'Cancel' : 'Select';
}
function enterChatSelect() {
  chatSelectMode = true;
  selectedThreads.clear();
  $('#chatThreadList')?.classList.add('selecting');
  updateChatSelectBar();
}
function exitChatSelect() {
  chatSelectMode = false;
  selectedThreads.clear();
  $('#chatThreadList')?.classList.remove('selecting');
  updateChatSelectBar();
  if (chatThreadsCache) paintChatThreads(chatThreadsCache);
}

$('#chatThreadList')?.addEventListener('click', (e) => {
  const row = e.target.closest('.chat-thread');
  if (!row) return;
  if (suppressNextChatClick) { suppressNextChatClick = false; return; }
  if (chatSelectMode) { toggleThreadSelected(row); return; }
  const thread = row.dataset.thread;
  activeChatThread = thread;
  adminUnreadThreads.delete(String(thread));
  updateChatsBadge();
  markThreadActiveInList(thread);   // in-place; no list rebuild / reload
  openChat(thread, 'admin');
});

/* Long-press (hold) to enter select mode and pick the held row. */
(function wireChatLongPress() {
  const host = $('#chatThreadList');
  if (!host) return;
  let timer = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  host.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.chat-thread');
    if (!row) return;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      suppressNextChatClick = true;     // the upcoming click is the hold's
      if (!chatSelectMode) enterChatSelect();
      toggleThreadSelected(row);
    }, 500);
  });
  ['pointerup', 'pointerleave', 'pointercancel', 'pointermove', 'scroll']
    .forEach(ev => host.addEventListener(ev, cancel, { passive: true }));
})();

$('#chatSelectToggle')?.addEventListener('click', () => {
  if (chatSelectMode) exitChatSelect(); else { enterChatSelect(); if (chatThreadsCache) paintChatThreads(chatThreadsCache); }
});
$('#chatSelectCancel')?.addEventListener('click', exitChatSelect);
$('#chatDeleteSelected')?.addEventListener('click', async () => {
  const labels = [...selectedThreads];
  if (!labels.length) return;
  const ok = await confirmAsk(
    `Delete ${labels.length} conversation${labels.length === 1 ? '' : 's'}? This permanently clears all messages for ${labels.length === 1 ? 'that table' : 'those tables'}.`,
    { title: 'Delete conversations', confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  for (const label of labels) {
    try { await Store.clearThread(label); } catch (e) { /* best-effort */ }
    adminUnreadThreads.delete(String(label));
    // If a deleted thread is the one open on the right, close it.
    if (String(activeChatThread) === String(label)) {
      activeChatThread = null;
      if (chatDrawer.classList.contains('open')) closeChat();
    }
  }
  if (chatThreadsCache) {
    chatThreadsCache = chatThreadsCache.filter(t => !labels.includes(String(t.thread)));
  }
  exitChatSelect();
  updateChatsBadge();
  loadChatThreads();
  showAdminToast({ title: `Deleted ${labels.length} conversation${labels.length === 1 ? '' : 's'}`, variant: 'danger' });
});
$('#refreshChatsBtn')?.addEventListener('click', loadChatThreads);

/* ----- Presence + typing ("Active now" / "typing…") -----------
   Identity-based and role-agnostic: the same code drives every
   pairing (admin↔client, client↔client). "Other" = any participant
   whose clientId differs from mine; the typing label comes from the
   sender's own name, so it reads correctly regardless of who's who. */
let presenceLeave = null, otherPresent = false, otherTyping = false, typingName = '', typingClearTimer = null, lastTypingSent = 0;
function updateChatStatus() {
  const sub = $('#chatSubtitle');
  if (!sub) return;
  if (otherTyping)  { sub.textContent = `${typingName || 'Someone'} is typing…`; sub.classList.add('chat-status-live'); return; }
  if (otherPresent) { sub.textContent = 'Active now';                             sub.classList.add('chat-status-live'); return; }
  sub.classList.remove('chat-status-live');
  sub.textContent = chatRole === 'admin' ? 'reply to this table' : 'ask about your order';
}
function startChatPresence(thread, role) {
  stopChatPresence();
  if (!Store.joinChatPresence) return;
  presenceLeave = Store.joinChatPresence({
    thread, role,
    name: role === 'admin' ? (Store.getSession()?.name || 'Staff') : customerChatName(),
    onPresence: (pstate, selfId) => {
      const everyone = Object.values(pstate || {}).flat();
      // Count a participant as "other" only if visible to us (admins,
      // or guests when guest-to-guest chat is enabled).
      otherPresent = everyone.some(p => p && p.id && p.id !== selfId && (chatShowsGuests() || p.role === 'admin'));
      updateChatStatus();
    },
    onTyping: (p, selfId) => {
      if (!p || p.id === selfId) return;           // ignore our own pings
      if (!(chatShowsGuests() || p.role === 'admin')) return;   // hidden guest
      otherTyping = true;
      typingName = p.name || (p.role === 'admin' ? 'Staff' : 'Guest');
      updateChatStatus();
      clearTimeout(typingClearTimer);
      typingClearTimer = setTimeout(() => { otherTyping = false; updateChatStatus(); }, 2500);
    },
  });
}
function stopChatPresence() {
  if (presenceLeave) { presenceLeave(); presenceLeave = null; }
  clearTimeout(typingClearTimer);
  otherPresent = false; otherTyping = false; typingName = '';
}
$('#chatInput').addEventListener('input', () => {
  const now = Date.now();
  if (Store.sendTyping && now - lastTypingSent > 1400) { Store.sendTyping(); lastTypingSent = now; }
});

/* ----- Mobile keyboard handling ------------------------------
   On phones the on-screen keyboard shrinks the VISUAL viewport but
   not the layout viewport, so a bottom-anchored fixed drawer gets
   shoved under the keyboard and the page jitters as the focused
   input is scrolled into view. We pin the drawer to the visual
   viewport instead: when the keyboard is up, lift the drawer above
   it and fill the visible height (it sits in the top area so the
   conversation stays readable); when the keyboard is down, revert
   to the CSS bottom-sheet. Desktop side-drawer is left untouched. */
function syncChatToViewport(scrollToEnd) {
  const drawer = $('#chatDrawer');
  if (!drawer) return;
  const vv = window.visualViewport;
  const mobile = window.innerWidth < 800;
  const reset = () => { drawer.style.bottom = ''; drawer.style.height = ''; drawer.style.maxHeight = ''; };
  if (!vv || !mobile || !drawer.classList.contains('open')) { reset(); return; }
  const kbInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  if (kbInset > 100) {                 // keyboard is up
    drawer.style.bottom    = kbInset + 'px';
    drawer.style.height    = vv.height + 'px';
    drawer.style.maxHeight = vv.height + 'px';
  } else {
    reset();
  }
  if (scrollToEnd) { const b = $('#chatBody'); if (b) b.scrollTop = b.scrollHeight; }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => syncChatToViewport(true));
  window.visualViewport.addEventListener('scroll', () => syncChatToViewport(false));
}
$('#chatInput').addEventListener('focus', () => setTimeout(() => syncChatToViewport(true), 120));

/* Whether the current viewer may see/interact with other GUESTS in
   the thread. Admins always can; guests only when the admin has
   enabled guest-to-guest chat. Drives both message visibility and
   presence/typing so the toggle behaves consistently. */
function chatShowsGuests() {
  return chatRole === 'admin' || !!(CONFIG && CONFIG.allowGuestChat);
}
function chatVisibleMessages() {
  let list = chatMessages;
  // Customer view: hide messages from before this device's current
  // visit (floor raised when a prior guest ended), so a returning/new
  // guest starts clean. Admin always sees the full history.
  if (chatRole !== 'admin' && chatThread) {
    const floor = chatFloorMap()[chatThread] || 0;
    if (floor) list = list.filter(m => new Date(m.ts).getTime() >= floor);
  }
  if (chatShowsGuests()) return list;
  const myId = Store.getClientId();
  return list.filter(m => m.role === 'admin' || m.sender === myId);
}

function renderChatMessages() {
  const body = $('#chatBody');
  const list = chatVisibleMessages();
  if (!list.length) {
    body.innerHTML = `<p class="empty-state">No messages yet. Say hi 👋</p>`;
    return;
  }
  body.innerHTML = list.map(m => {
    const mine = (chatRole === 'admin') ? (m.role === 'admin') : (m.role === 'customer' && m.sender === Store.getClientId());
    let inner;
    if (m.kind === 'image')      inner = `<img class="chat-img" src="${m.body}" alt="photo" />`;
    else if (m.kind === 'audio') inner = voiceMsgMarkup(m, mine);
    else                         inner = `<span>${escapeHtml(m.body)}</span>`;
    const replyHtml = m.replyTo
      ? `<div class="chat-reply-quote">${escapeHtml(m.replyPreview || 'message')}</div>` : '';
    const reactHtml = m.reaction
      ? `<span class="chat-react" aria-label="reaction">${m.reaction}</span>` : '';
    // Per-person colour: staff share one colour; each customer name its
    // own. Drives the name label + a bubble accent so senders are easy
    // to tell apart at a glance.
    const who = m.senderName || (m.role === 'admin' ? 'Staff' : 'Guest');
    const color = colorForName(m.role === 'admin' ? 'Staff' : who);
    return `
      <div class="chat-msg ${mine ? 'mine' : 'theirs'}${m.reaction ? ' has-react' : ''}" data-id="${m.id}" style="--who-color:${color}">
        ${(!mine) ? `<small class="chat-who" style="color:${color}">${escapeHtml(who)}</small>` : ''}
        <div class="chat-bubble chat-${m.kind}">${replyHtml}${inner}${reactHtml}</div>
        <small class="chat-time">${timeAgo(new Date(m.ts), Store.serverNow ? Store.serverNow() : Date.now())}</small>
      </div>`;
  }).join('');
  initVoicePlayers();
  body.scrollTop = body.scrollHeight;
}

/* ============================================================
   VOICE MESSAGE PLAYER  (Messenger-style waveform + scrub)
   - Waveform: decode the data-URL once via Web Audio, reduce to
     WF_BARS RMS amplitude bars + an ACCURATE duration; cache both
     per message id (re-renders are then free).
   - Playback: a persistent HTMLAudioElement per id kept in JS
     memory (never in the DOM) so it survives the chat's innerHTML
     rebuilds and keeps playing; the canvas re-binds to it.
   - Sync: audio events are the source of truth; one rAF loop
     redraws only the active player for smooth progress.
   ============================================================ */
const WF_BARS = 48;
const voiceAudioEls = new Map();   // id -> HTMLAudioElement (persists)
const voicePeaks    = new Map();   // id -> Float32Array | 'pending'
const voiceDur      = new Map();   // id -> accurate seconds (from decode)
let   _wfAudioCtx   = null;
let   activeVoiceId = null;
let   wfRaf         = null;
const PLAY_ICON  = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;

function voiceMsgMarkup(m, mine) {
  return `<div class="voice-msg ${mine ? 'mine-voice' : 'their-voice'}" data-id="${m.id}" role="group" aria-label="Voice message">
            <button class="voice-play" aria-label="Play">${PLAY_ICON}</button>
            <div class="voice-wave-wrap"><canvas class="voice-wave"></canvas></div>
            <span class="voice-time">0:00</span>
          </div>`;
}
function fmtClock(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function voiceEl(id) { return document.querySelector(`#chatBody .voice-msg[data-id="${id}"]`); }
function wfAudioCtx() { if (!_wfAudioCtx) { const C = window.AudioContext || window.webkitAudioContext; _wfAudioCtx = C ? new C() : null; } return _wfAudioCtx; }

/* Round-rect path with a fallback for older canvas impls. */
function wfRoundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Decode → RMS bars + accurate duration. Cached; safe to call many times. */
async function computeVoicePeaks(id, src) {
  if (voicePeaks.has(id)) return;
  voicePeaks.set(id, 'pending');
  try {
    const ctx = wfAudioCtx();
    if (!ctx) throw new Error('no AudioContext');
    const arrBuf = await fetch(src).then(r => r.arrayBuffer());
    const audioBuf = await ctx.decodeAudioData(arrBuf);
    voiceDur.set(id, audioBuf.duration);
    const ch = audioBuf.getChannelData(0);
    const block = Math.max(1, Math.floor(ch.length / WF_BARS));
    const peaks = new Float32Array(WF_BARS);
    let max = 1e-4;
    for (let i = 0; i < WF_BARS; i++) {
      let sum = 0, n = 0;
      const start = i * block;
      for (let j = 0; j < block && start + j < ch.length; j++) { const v = ch[start + j]; sum += v * v; n++; }
      const rms = Math.sqrt(sum / (n || 1));
      peaks[i] = rms; if (rms > max) max = rms;
    }
    for (let i = 0; i < WF_BARS; i++) peaks[i] = Math.min(1, peaks[i] / max);
    voicePeaks.set(id, peaks);
  } catch (e) {
    voicePeaks.set(id, voiceFallbackPeaks());   // graceful: a gentle static shape
  }
  // Redraw whatever element currently shows this id (survives any
  // re-render that happened while we were decoding).
  const cur = voiceEl(id);
  if (cur) { drawVoice(cur); const a = voiceAudioEls.get(id); if (a) updateVoiceTime(cur, a); }
}
function voiceFallbackPeaks() {
  const p = new Float32Array(WF_BARS);
  for (let i = 0; i < WF_BARS; i++) p[i] = 0.3 + 0.45 * Math.abs(Math.sin(i * 0.7));
  return p;
}

let _wfAccent = '';
function wfAccentColor() {
  if (!_wfAccent) _wfAccent = (getComputedStyle(document.documentElement).getPropertyValue('--primary') || '#C18F1E').trim();
  return _wfAccent;
}

function drawVoice(el) {
  if (!el) return;
  const id = el.dataset.id;
  const wrap = el.querySelector('.voice-wave-wrap');
  const canvas = el.querySelector('.voice-wave');
  if (!wrap || !canvas) return;
  const a = voiceAudioEls.get(id);
  const dur = voiceDur.get(id) || (a && isFinite(a.duration) ? a.duration : 0);
  const ratio = (a && dur) ? Math.min(1, Math.max(0, a.currentTime / dur)) : 0;
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth || 160, h = wrap.clientHeight || 30;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const peaks = voicePeaks.get(id);
  const arr = (peaks && peaks !== 'pending') ? peaks : null;
  const mine = el.classList.contains('mine-voice');
  const playedColor = mine ? '#ffffff' : wfAccentColor();
  const restColor   = mine ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.18)';
  const gap = 2;
  const bw = Math.max(2, (w - (WF_BARS - 1) * gap) / WF_BARS);
  for (let i = 0; i < WF_BARS; i++) {
    const v = arr ? arr[i] : 0.4;
    const bh = Math.max(2, v * (h - 4));
    const x = i * (bw + gap);
    ctx.fillStyle = (((i + 0.5) / WF_BARS) <= ratio) ? playedColor : restColor;
    wfRoundRect(ctx, x, (h - bh) / 2, bw, bh, bw / 2);
    ctx.fill();
  }
}
function updateVoiceTime(el, a) {
  const t = el && el.querySelector('.voice-time');
  if (!t || !a) return;
  const dur = voiceDur.get(el.dataset.id) || (isFinite(a.duration) ? a.duration : 0);
  const show = (!a.paused || a.currentTime > 0.05) ? a.currentTime : dur;
  t.textContent = fmtClock(show);
}
function syncVoiceBtn(el, a) {
  const b = el && el.querySelector('.voice-play');
  if (!b || !a) return;
  const playing = !a.paused && !a.ended;
  b.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  el.classList.toggle('playing', playing);
}

function wfLoop() {
  wfRaf = null;
  if (!activeVoiceId) return;
  const a = voiceAudioEls.get(activeVoiceId);
  const el = voiceEl(activeVoiceId);
  if (el && a) { drawVoice(el); updateVoiceTime(el, a); }
  if (a && !a.paused) wfRaf = requestAnimationFrame(wfLoop);
}
function startWfLoop() { if (!wfRaf) wfRaf = requestAnimationFrame(wfLoop); }

/* Persistent audio per id, with the webm/MediaRecorder duration-fix
   (duration can report Infinity until a forced seek), wired ONCE so
   re-renders never stack listeners. Handlers look up the live element
   by id at event time rather than closing over a stale node. */
function getVoiceAudio(id, src) {
  let a = voiceAudioEls.get(id);
  if (a) return a;
  a = new Audio();
  a.preload = 'metadata';
  a.src = src;
  a.addEventListener('loadedmetadata', () => {
    if (a.duration === Infinity || isNaN(a.duration)) {
      try {
        a.currentTime = 1e101;
        const fix = () => { a.currentTime = 0; a.removeEventListener('timeupdate', fix); };
        a.addEventListener('timeupdate', fix);
      } catch (e) {}
    }
  });
  a.addEventListener('play',  () => { activeVoiceId = id; const el = voiceEl(id); if (el) syncVoiceBtn(el, a); startWfLoop(); });
  a.addEventListener('pause', () => { const el = voiceEl(id); if (el) { syncVoiceBtn(el, a); drawVoice(el); updateVoiceTime(el, a); } });
  a.addEventListener('ended', () => { a.currentTime = 0; const el = voiceEl(id); if (el) { syncVoiceBtn(el, a); drawVoice(el); updateVoiceTime(el, a); } });
  a.addEventListener('seeked', () => { const el = voiceEl(id); if (el) { drawVoice(el); updateVoiceTime(el, a); } });
  a.addEventListener('timeupdate', () => { if (a.paused) { const el = voiceEl(id); if (el) { drawVoice(el); updateVoiceTime(el, a); } } });
  voiceAudioEls.set(id, a);
  return a;
}
function toggleVoice(id) {
  const a = voiceAudioEls.get(id);
  if (!a) return;
  if (a.paused) {
    if (activeVoiceId && activeVoiceId !== id) { const prev = voiceAudioEls.get(activeVoiceId); if (prev) prev.pause(); }
    activeVoiceId = id;
    a.play().catch(() => {});
  } else {
    a.pause();
  }
}
/* Tap = jump, drag = continuous scrub. Pointer capture keeps the drag
   smooth; stopPropagation prevents the chat swipe-to-reply / double-
   tap-react gestures from firing on the waveform. */
function wireVoiceSeek(el, id) {
  const wrap = el.querySelector('.voice-wave-wrap');
  if (!wrap) return;
  let seeking = false;
  const ratioFrom = (e) => {
    const r = wrap.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1)));
  };
  const applySeek = (ratio) => {
    const a = voiceAudioEls.get(id);
    const dur = voiceDur.get(id) || (a && isFinite(a.duration) ? a.duration : 0);
    if (a && dur) a.currentTime = ratio * dur;
    drawVoice(el); if (a) updateVoiceTime(el, a);
  };
  wrap.addEventListener('pointerdown', (e) => {
    seeking = true;
    try { wrap.setPointerCapture(e.pointerId); } catch (x) {}
    applySeek(ratioFrom(e));
    e.preventDefault(); e.stopPropagation();
  });
  wrap.addEventListener('pointermove', (e) => { if (!seeking) return; applySeek(ratioFrom(e)); e.stopPropagation(); });
  const end = (e) => { if (!seeking) return; seeking = false; try { wrap.releasePointerCapture(e.pointerId); } catch (x) {} e.stopPropagation(); };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
}
/* Wire/refresh every voice bubble after a render. Element-level
   handlers bind to the fresh nodes; the audio object + peaks are
   cached so this is cheap and playback state is preserved. */
function initVoicePlayers() {
  $$('#chatBody .voice-msg').forEach(el => {
    const id = el.dataset.id;
    const msg = chatMessages.find(x => x.id === id);
    if (!msg) return;
    const a = getVoiceAudio(id, msg.body);
    computeVoicePeaks(id, msg.body);     // cached + self-redraws on completion
    el.querySelector('.voice-play').addEventListener('click', (e) => { e.stopPropagation(); toggleVoice(id); });
    wireVoiceSeek(el, id);
    syncVoiceBtn(el, a); drawVoice(el); updateVoiceTime(el, a);
  });
}
/* Keep the active waveform crisp on resize; resume the loop when the
   tab returns to the foreground (rAF is frozen while backgrounded). */
window.addEventListener('resize', () => { $$('#chatBody .voice-msg').forEach(drawVoice); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const a = activeVoiceId && voiceAudioEls.get(activeVoiceId);
  if (a && !a.paused) startWfLoop();
  const el = activeVoiceId && voiceEl(activeVoiceId);
  if (el && a) { drawVoice(el); updateVoiceTime(el, a); }
});

/* ----- Reply state -------------------------------------------- */
let chatReplyTo = null;
function chatSnippet(m) {
  if (!m) return '';
  if (m.kind === 'image') return '📷 Photo';
  if (m.kind === 'audio') return '🎤 Voice note';
  return (m.body || '').slice(0, 90);
}
function chatSenderLabel(m) {
  return m.senderName || (m.role === 'admin' ? 'Staff' : 'Guest');
}
function setChatReply(m) {
  const bar = $('#chatReplyBar');
  if (!m) { chatReplyTo = null; if (bar) bar.hidden = true; return; }
  chatReplyTo = { id: m.id, preview: `${chatSenderLabel(m)}: ${chatSnippet(m)}` };
  $('#chatReplyName').textContent    = chatSenderLabel(m);
  $('#chatReplySnippet').textContent = chatSnippet(m);
  bar.hidden = false;
  $('#chatInput').focus();
}
$('#chatReplyCancel').addEventListener('click', () => setChatReply(null));

/* ----- Double-tap to react (single ❤️) ------------------------ */
async function toggleReaction(m) {
  if (!m) return;
  const next = m.reaction ? null : '❤️';
  m.reaction = next;                 // optimistic
  renderChatMessages();
  if (next) {
    const el = $(`#chatBody .chat-msg[data-id="${m.id}"] .chat-react`);
    if (el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  }
  try { await Store.setReaction(m.id, next); }
  catch (e) { /* keeps the optimistic state; reconciles on next fetch */ }
}

/* ----- Gestures: double-tap = react, horizontal swipe = reply -- */
let chatGesture = null, chatLastTap = null;
const REPLY_SWIPE_PX = 55;
(function wireChatGestures() {
  const body = $('#chatBody');
  if (!body) return;
  body.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.chat-msg');
    // Don't hijack interaction with the audio player.
    if (!el || e.target.closest('audio')) { chatGesture = null; return; }
    chatGesture = { id: el.dataset.id, el, x: e.clientX, y: e.clientY, drag: false, dx: 0 };
  });
  body.addEventListener('pointermove', (e) => {
    if (!chatGesture) return;
    const dx = e.clientX - chatGesture.x, dy = e.clientY - chatGesture.y;
    chatGesture.dx = dx;
    if (!chatGesture.drag && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) chatGesture.drag = true;
    if (chatGesture.drag) {
      e.preventDefault();
      chatGesture.el.style.transform = `translateX(${Math.max(-80, Math.min(80, dx))}px)`;
      chatGesture.el.classList.toggle('swiping-reply', Math.abs(dx) > REPLY_SWIPE_PX);
    }
  });
  const endGesture = (e) => {
    if (!chatGesture) return;
    const g = chatGesture; chatGesture = null;
    const m = chatMessages.find(x => x.id === g.id);
    g.el.classList.remove('swiping-reply');
    g.el.style.transition = 'transform .18s ease';
    g.el.style.transform = '';
    setTimeout(() => { g.el.style.transition = ''; }, 200);
    const dy = (e.clientY || g.y) - g.y;
    const moved = Math.hypot(g.dx, dy);
    if (g.drag) {
      if (Math.abs(g.dx) > REPLY_SWIPE_PX) setChatReply(m);
    } else if (moved < 10) {
      const now = Date.now();
      if (chatLastTap && chatLastTap.id === g.id && now - chatLastTap.t < 320) {
        chatLastTap = null;
        toggleReaction(m);
      } else {
        chatLastTap = { id: g.id, t: now };
      }
    }
  };
  body.addEventListener('pointerup', endGesture);
  body.addEventListener('pointercancel', () => { if (chatGesture) { chatGesture.el.style.transform = ''; chatGesture.el.classList.remove('swiping-reply'); chatGesture = null; } });
})();

/* Reaction / edit arriving from the other device. */
window.addEventListener('bb-chat-update', (e) => {
  const m = e.detail && e.detail.message;
  if (!m || m.thread !== chatThread) return;
  const idx = chatMessages.findIndex(x => x.id === m.id);
  if (idx >= 0) { chatMessages[idx] = m; renderChatMessages(); }
});

async function sendChat(kind, body) {
  if (!chatThread) return;
  const text = (kind === 'text') ? (body || '').trim() : body;
  if (!text) return;
  try {
    const msg = await Store.sendMessage({
      thread: chatThread, role: chatRole, kind, body: text,
      senderName: chatRole === 'admin'
        ? (Store.getSession()?.name || 'Staff')
        : customerChatName(),
      replyTo:      chatReplyTo ? chatReplyTo.id : null,
      replyPreview: chatReplyTo ? chatReplyTo.preview : null,
    });
    setChatReply(null);              // clear the reply context after sending
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
      updateChatsBadge();
      if (!adminPanel.hidden && $('.admin-tab.active')?.dataset.adminTab === 'chats') renderChatThreads();
    } else if (!iAmAdmin) {
      // Customer-side: a clear, unmissable cue that staff replied —
      // a toast plus the bouncing/glowing chat FAB (lit in
      // refreshChatDot below).
      showToast('New message from staff 💬');
    }
  }
  if (viewingThisThread) {
    if (!chatMessages.some(m => m.id === msg.id)) {
      chatMessages.push(msg);
      renderChatMessages();
      markChatSeen(chatThread, new Date(msg.ts).getTime());
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
  const fab = $('#fabChatBtn');
  if (!dot) return;
  const clear = () => { dot.hidden = true; fab && fab.classList.remove('attn'); };
  if (chatRole === 'admin') { clear(); return; }              // dot is customer-only
  const thread = state.tableNumber;
  if (!thread) { clear(); return; }
  // Reading the thread right now → nothing pending, stop the cue.
  if (chatDrawer.classList.contains('open') && chatThread === thread) { clear(); return; }
  // A fresh staff message for this table → light the dot and make
  // the FAB bounce/glow so it can't be missed.
  if (incoming && incoming.thread === thread && incoming.role === 'admin') {
    dot.hidden = false;
    fab && fab.classList.add('attn');
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
function timeAgo(d, now = Date.now()) {
  const t = (d instanceof Date) ? d.getTime() : new Date(d).getTime();
  if (isNaN(t)) return '';
  // Clamp to 0: nothing is in the future. Callers pass a server-
  // referenced `now` (Store.serverNow()) for cross-device data like
  // chat, so a device whose own clock is off doesn't skew the label.
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 5)     return 'just now';
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
}

/* ==========================================================
   BOOT
   ========================================================== */
async function boot() {
  // Recovery escape hatch — open the site with ?reset=1 to wipe ALL
  // local data (cache, pending sync queue, sign-in) WITHOUT needing
  // to sign in. For when local state gets wedged and the normal UI
  // or admin panel can't be reached. Server data is untouched; the
  // next load re-pulls a clean copy from Supabase. Runs first, before
  // anything that could itself throw.
  if (new URLSearchParams(location.search).get('reset') === '1') {
    try {
      Store.factoryReset();
      ['bb_chat_local', 'bossb_active_order', 'bb_chat_seen', 'bb_pin_hint_seen', 'bb_dismissed_orders']
        .forEach(k => localStorage.removeItem(k));
    } catch (e) { /* best-effort */ }
    location.replace(location.pathname);   // drop the param + reload clean
    return;
  }
  initTheme();
  applyConfigToDOM();
  // Migration: an older build cached the table label here so
  // the customer wouldn't have to retype it after reload. We
  // now always re-prompt — clean the stale key on boot so it
  // doesn't accidentally pre-fill.
  localStorage.removeItem('bossb_table');
  await Store.bootSeed();

  // If a remembered session (admin OR customer) no longer matches
  // a live account — the account was renamed/removed on the server,
  // e.g. after the admin-email rebrand — drop it and prompt a fresh
  // sign-in so a stale login can't linger on this device.
  const remembered = Store.getSession();
  if (remembered && Store.sessionStale()) {
    const wasAdmin = remembered.role === 'admin';
    Store.logout();
    refreshAdminHeaderBtn();
    showToast('Your account is no longer available — please sign in again', 'error');
    if (wasAdmin) openStaffLogin();
  }

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
  syncTopbarHeight();
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
  // Returning signed-in customer (e.g. just created an account on
  // signup.html and was redirected back): silently link this session's
  // guest orders to the account, then credit points for any completed
  // orders. Idempotent and keyed by orderId, so no double counting.
  if (Store.isCustomer && Store.isCustomer()) {
    const c = Store.getCustomer();
    if (c) Store.linkSessionOrdersToAccount(c.id);
  }
  reconcileCustomerPoints();

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

/* Keep --topbar-h synced to the *actual* sticky topbar height so
   the category chips pin flush below it. The topbar grows/shrinks
   when the table-strip wraps or the order-status banner toggles, so
   a hardcoded offset (the old top:87px) let the topbar's lower edge
   cover the chips. ResizeObserver tracks every height change. */
function syncTopbarHeight() {
  const topbar = $('.topbar');
  if (!topbar) return;
  const h = Math.round(topbar.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--topbar-h', h + 'px');
}
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(syncTopbarHeight);
  document.addEventListener('DOMContentLoaded', () => {
    const topbar = $('.topbar');
    if (topbar) ro.observe(topbar);
  });
}
window.addEventListener('resize', syncTopbarHeight);

/* Customer topbar → pull-down on deep scroll.
   Past 30vh the topbar slides up out of view and a small handle tab
   appears; tapping it pulls the real topbar (shop name + table strip)
   back down as an overlay. Near the top it reverts (hysteresis avoids
   boundary flicker), and the open state resets. A separate right-side
   back-to-top button appears on deeper scrolls. All fixed transforms,
   so document flow never shifts. */
(function wireScrollNav() {
  const view   = $('#customerView');
  const handle = $('#navHandle');
  const toTop  = $('#backToTop');
  if (!view || !handle) return;
  let docked = false, open = false, ticking = false, lastY = window.scrollY;
  const dockAt = () => window.innerHeight * 0.30;
  const topAt  = () => window.innerHeight * 0.60;

  function setOpen(on) {
    open = on;
    view.classList.toggle('nav-open', on);
    handle.setAttribute('aria-expanded', String(on));
    handle.setAttribute('aria-label', on ? 'Hide navigation bar' : 'Show navigation bar');
  }
  function setDocked(on) {
    if (on === docked) return;
    docked = on;
    view.classList.toggle('nav-docked', on);
    if (!on) setOpen(false);        // reset the pulled-open override on revert
  }
  function apply() {
    ticking = false;
    const y = window.scrollY;
    if (!docked && y > dockAt())            setDocked(true);
    else if (docked && y < dockAt() * 0.8)  setDocked(false);   // hysteresis
    // The pulled-open topbar is a peek — any real scroll tucks it back.
    if (open && Math.abs(y - lastY) > 4)    setOpen(false);
    if (toTop) toTop.classList.toggle('show', y > topAt());
    lastY = y;
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(apply); }
  }, { passive: true });
  window.addEventListener('resize', apply);

  handle.addEventListener('click', () => setOpen(!open));
  if (toTop) toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  apply();
})();

/* During pinch-zoom / rotate the layout viewport recalculates and
   fixed elements (FABs, topbar) can momentarily jut as positions
   resolve. Suppress their transitions for the duration of the change
   so nothing animates into/out of view; restore shortly after. */
(function wireViewportAnimGuard() {
  let t = null;
  const onChange = () => {
    document.body.classList.add('vp-resizing');
    clearTimeout(t);
    t = setTimeout(() => document.body.classList.remove('vp-resizing'), 280);
  };
  window.addEventListener('resize', onChange, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onChange, { passive: true });
    window.visualViewport.addEventListener('scroll', onChange, { passive: true });
  }
})();

document.addEventListener('DOMContentLoaded', boot);
