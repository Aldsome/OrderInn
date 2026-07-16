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
  search:      '',          // live menu search query (feature: menu search)
  sort:        'relevance', // menu sort: relevance | price-asc | price-desc | name
  favoritesOnly: false,     // filter: show only favorited items
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

/* The single menu filter+sort pipeline. Applies, in order:
   category → favorites-only → text search → sort. Every menu render
   goes through here so the four controls compose predictably. */
function filterMenuItems() {
  let items = MENU.slice();

  // 1. Category (chips / sidebar). 'all' = no category filter.
  if (state.category !== 'all') {
    items = items.filter(m => m.category === state.category);
  }

  // 2. Favorites-only toggle.
  if (state.favoritesOnly) {
    const favs = new Set(Store.getFavorites());
    items = items.filter(m => favs.has(m.id));
  }

  // 3. Text search — case-insensitive substring over name + description
  //    + category label, the way food-ordering search behaves (type
  //    "choc" → Chocolate Cookie; "iced" → all iced drinks).
  const q = (state.search || '').trim().toLowerCase();
  if (q) {
    items = items.filter(m => {
      const hay = `${m.name} ${m.desc || ''} ${m.category || ''} ${m.tag || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }

  // 4. Sort.
  switch (state.sort) {
    case 'price-asc':  items.sort((a, b) => a.price - b.price); break;
    case 'price-desc': items.sort((a, b) => b.price - a.price); break;
    case 'name':       items.sort((a, b) => a.name.localeCompare(b.name)); break;
    // 'relevance' = leave in menu (curated) order, except when searching
    // we surface name-start matches first so the best hit leads.
    default:
      if (q) {
        items.sort((a, b) => {
          const as = a.name.toLowerCase().startsWith(q) ? 0 : 1;
          const bs = b.name.toLowerCase().startsWith(q) ? 0 : 1;
          return as - bs;
        });
      }
  }
  return items;
}

/* Context-appropriate empty-state copy so a no-results view explains
   WHY it's empty (bad search vs. no favorites vs. empty category). */
function emptyMenuMessage() {
  const q = (state.search || '').trim();
  if (q)                 return `No items match “${escapeHtml(q)}”. Try another search.`;
  if (state.favoritesOnly) return 'No favorites yet. Tap the ♥ on any item to save it here.';
  return 'No items in this category.';
}

function renderMenu() {
  // First real render replaces the boot-time skeleton; drop aria-busy
  // now that the grid reflects actual (possibly empty) menu data.
  menuGrid.removeAttribute('aria-busy');

  const items = filterMenuItems();

  if (items.length === 0) {
    menuGrid.innerHTML =
      `<p class="empty-state" style="grid-column:1/-1">${emptyMenuMessage()}</p>`;
    return;
  }

  menuGrid.innerHTML = items.map(item => {
    const faved = Store.isFavorite(item.id);
    return `
    <article class="product-card" data-id="${item.id}"
             role="button" tabindex="0"
             aria-label="Customize and add ${escapeHtml(item.name)}, ${peso(item.price)}">
      <div class="placeholder-img" aria-hidden="true">
        ${thumbMarkup(item, { alt: item.name })}
      </div>
      <button type="button" class="fav-heart${faved ? ' is-fav' : ''}"
              data-fav="${escapeHtml(item.id)}"
              aria-pressed="${faved}"
              aria-label="${faved ? 'Remove from' : 'Add to'} favorites">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 1.9 4.9 5.2 4.3 7.3 3.9 9.3 5 12 7.6 14.7 5 16.7 3.9 18.8 4.3c3.3.6 4.8 4.1 3.2 7.4C19.5 16.4 12 21 12 21z"/>
        </svg>
      </button>
      <div class="product-body">
        ${item.tag ? `<span class="tag">${escapeHtml(item.tag)}</span>` : ''}
        <h3>${escapeHtml(item.name)}</h3>
        <p class="desc">${escapeHtml(item.desc || '')}</p>
        <div class="row-bottom">
          <span class="price">${peso(item.price)}</span>
        </div>
      </div>
    </article>
  `;
  }).join('');
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

/* ==========================================================
   FILTERS  (desktop sidebar + mobile bottom sheet)
   Both surfaces render the SAME control markup via renderFilters()
   into their respective host (#sidebarFilters / #sheetFilters), and
   a single delegated handler on each host drives category, sort, and
   favorites. Keeping one markup builder avoids the two surfaces
   drifting out of sync.
   ========================================================== */
const SORT_OPTIONS = [
  { id: 'relevance',  label: 'Relevance' },
  { id: 'price-asc',  label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'name',       label: 'Name (A–Z)' },
];

function filtersMarkup(groupName) {
  const cats = Store.getCategories();
  const favN = Store.favoriteCount();

  const catRow = (id, label) => `
    <button type="button" class="filter-cat${state.category === id ? ' active' : ''}"
            data-filter-cat="${escapeHtml(id)}">
      <span>${escapeHtml(label)}</span>
    </button>`;

  const sortRow = (o) => `
    <label class="filter-radio">
      <input type="radio" name="${groupName}" value="${o.id}" ${state.sort === o.id ? 'checked' : ''}>
      <span>${escapeHtml(o.label)}</span>
    </label>`;

  return `
    <section class="filter-group">
      <h4 class="filter-title">Categories</h4>
      <div class="filter-cats">
        ${catRow('all', 'All items')}
        ${cats.map(c => catRow(c.id, c.label)).join('')}
      </div>
    </section>

    <section class="filter-group">
      <h4 class="filter-title">Sort by</h4>
      <div class="filter-sorts">
        ${SORT_OPTIONS.map(sortRow).join('')}
      </div>
    </section>

    <section class="filter-group">
      <button type="button"
              class="filter-fav-toggle${state.favoritesOnly ? ' on' : ''}${favN ? ' has-favs' : ''}"
              data-fav-toggle
              aria-pressed="${state.favoritesOnly}">
        <span class="ff-heart" aria-hidden="true">♥</span>
        <span class="ff-label">Favorites only</span>
        <span class="ff-count" data-fav-count>${favN}</span>
      </button>
    </section>`;
}

/* Each host gets its own radio-group name. Without this, the sidebar
   and the mobile sheet both render <input name="menuSort">, and the
   browser treats same-name radios as ONE mutually-exclusive group
   across the whole document — not scoped per container — so setting
   one host's selection could silently uncheck the other's, leaving
   neither visibly selected. */
const FILTER_HOSTS = { '#sidebarFilters': 'menuSort-sidebar', '#sheetFilters': 'menuSort-sheet' };

function renderFilters() {
  Object.entries(FILTER_HOSTS).forEach(([sel, groupName]) => {
    const host = $(sel);
    if (host) host.innerHTML = filtersMarkup(groupName);
  });
  refreshFilterActiveDot();
}

/* Delegated handler shared by both filter hosts. */
function onFilterHostClick(e) {
  const cat = e.target.closest('[data-filter-cat]');
  if (cat) { setCategory(cat.dataset.filterCat); return; }

  const favToggle = e.target.closest('[data-fav-toggle]');
  if (favToggle) {
    state.favoritesOnly = !state.favoritesOnly;
    renderFilters();
    renderMenu();
    return;
  }
}
function onFilterHostChange(e) {
  const radio = e.target.closest('input[type="radio"]');
  if (radio && SORT_OPTIONS.some(o => o.id === radio.value)) {
    state.sort = radio.value;
    renderFilters();
    renderMenu();
  }
}

/* Shows a dot on the mobile "Filters" button when any non-default
   filter is active, so users know a filter is narrowing results. */
function refreshFilterActiveDot() {
  const active = state.category !== 'all' || state.sort !== 'relevance' || state.favoritesOnly;
  const dot = $('#filterActiveDot');
  if (dot) dot.hidden = !active;
}

/* ----- Mobile filter sheet open/close ----- */
function openFilterSheet() {
  const sheet = $('#filterSheet'), back = $('#filterSheetBackdrop');
  if (!sheet) return;
  back.hidden = false; sheet.hidden = false;
  requestAnimationFrame(() => { back.classList.add('open'); sheet.classList.add('open'); });
  document.body.style.overflow = 'hidden';
}
function closeFilterSheet() {
  const sheet = $('#filterSheet'), back = $('#filterSheetBackdrop');
  if (!sheet) return;
  back.classList.remove('open'); sheet.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => { back.hidden = true; sheet.hidden = true; }, 260);
}

function wireFilters() {
  $('#sidebarFilters')?.addEventListener('click', onFilterHostClick);
  $('#sidebarFilters')?.addEventListener('change', onFilterHostChange);
  $('#sheetFilters')?.addEventListener('click', onFilterHostClick);
  $('#sheetFilters')?.addEventListener('change', onFilterHostChange);

  $('#filterOpenBtn')?.addEventListener('click', openFilterSheet);
  $('#filterSheetClose')?.addEventListener('click', closeFilterSheet);
  $('#filterSheetBackdrop')?.addEventListener('click', closeFilterSheet);
  $('#filterDoneBtn')?.addEventListener('click', closeFilterSheet);
  $('#filterClearBtn')?.addEventListener('click', () => {
    state.category = 'all'; state.sort = 'relevance'; state.favoritesOnly = false;
    $$('.chip', $('#categoryChips')).forEach(c =>
      c.classList.toggle('active', c.dataset.category === 'all'));
    renderFilters(); renderMenu();
  });

  // Drag-to-dismiss the sheet.
  wireSheetDrag();
}

/* Lightweight drag-down-to-close on the sheet handle. */
function wireSheetDrag() {
  const sheet = $('#filterSheet'), handle = $('#filterSheetHandle');
  if (!sheet || !handle) return;
  let startY = 0, dy = 0, dragging = false;
  const onDown = (y) => { startY = y; dragging = true; sheet.style.transition = 'none'; };
  const onMove = (y) => {
    if (!dragging) return;
    dy = Math.max(0, y - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 90) closeFilterSheet();
    dy = 0;
  };
  handle.addEventListener('touchstart', (e) => onDown(e.touches[0].clientY), { passive: true });
  handle.addEventListener('touchmove',  (e) => onMove(e.touches[0].clientY), { passive: true });
  handle.addEventListener('touchend', onUp);
  handle.addEventListener('mousedown', (e) => { onDown(e.clientY);
    const mm = (ev) => onMove(ev.clientY), mu = () => { onUp(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  });
}

/* Welcome band. Time-aware greeting + shop name + tagline + a live
   "customer favorite" chip (top best-seller from real order data).
   The reveal is enhancement-only: content is written first (so it's
   present even if the animation never runs), then .hero-in is added
   to replay the staggered rise. Called on boot and again whenever the
   config or menu changes so the favorite stays current. */
let heroRevealed = false;
function renderHero() {
  const hero = $('#hero');
  if (!hero) return;

  const h = new Date().getHours();
  const greeting =
    h < 5  ? 'Late night ☕'   :
    h < 12 ? 'Good morning ☕'  :
    h < 17 ? 'Good afternoon ☕':
    h < 22 ? 'Good evening ☕'  :
             'Winding down ☕';
  $('#heroGreeting').textContent = greeting;
  // Brand logo lives in the topbar now; the hero leads with a warm
  // welcome line + the shop tagline.
  const title = $('#heroTitle');
  if (title) title.textContent = `Welcome to ${CONFIG.shopName || 'OrderInn Coffee'}`;
  const tagline = $('#heroTagline');
  if (tagline) tagline.textContent = CONFIG.tagline || '';

  // Live favorite — the #1 best-seller (falls back to the first menu
  // item when there's no order history yet). Hidden if the menu is empty.
  const fav = getBestSellers(1)[0];
  const favBtn = $('#heroFav');
  if (fav && favBtn) {
    $('#heroFavThumb').innerHTML = thumbMarkup(fav, { alt: fav.name });
    $('#heroFavName').textContent = fav.name;
    favBtn.dataset.id = fav.id;
    favBtn.hidden = false;
  } else if (favBtn) {
    favBtn.hidden = true;
  }

  // Play the entrance once per page load (not on every config refresh).
  if (!heroRevealed) {
    heroRevealed = true;
    // Next frame so the browser has painted the resting state first,
    // giving the animation something to animate FROM.
    requestAnimationFrame(() => hero.classList.add('hero-in'));
  }
}

/* Tapping the hero's favorite chip opens that item's customizer —
   the "try it" hook that turns the first impression into an action. */
(function wireHeroFav() {
  const favBtn = $('#heroFav');
  if (favBtn) favBtn.addEventListener('click', () => {
    if (favBtn.dataset.id) openCustomizer(favBtn.dataset.id);
  });
})();
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
  setCategory(chip.dataset.category);
  alignMenuUnderChips();
});

/* Single entry point for changing category — keeps the chip row and
   the sidebar/sheet category lists in sync, then re-renders. */
function setCategory(id) {
  state.category = id;
  $$('.chip', $('#categoryChips')).forEach(c =>
    c.classList.toggle('active', c.dataset.category === id));
  renderFilters();     // reflect active category in sidebar + sheet
  renderMenu();
}

/* ==========================================================
   MENU SEARCH
   ========================================================== */
const menuSearchEl = $('#menuSearch');
const menuSearchClear = $('#menuSearchClear');
if (menuSearchEl) {
  menuSearchEl.addEventListener('input', () => {
    state.search = menuSearchEl.value;
    menuSearchClear.hidden = !menuSearchEl.value;
    renderMenu();
  });
  // Esc clears the field (standard search behavior).
  menuSearchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuSearchEl.value) { e.preventDefault(); clearMenuSearch(); }
  });
  menuSearchClear.addEventListener('click', clearMenuSearch);
}
function clearMenuSearch() {
  state.search = '';
  if (menuSearchEl) menuSearchEl.value = '';
  if (menuSearchClear) menuSearchClear.hidden = true;
  renderMenu();
  if (menuSearchEl) menuSearchEl.focus();
}

menuGrid.addEventListener('click', (e) => {
  // Favorite heart — handle first and swallow the click so it doesn't
  // bubble up to the card and open the customizer.
  const heart = e.target.closest('.fav-heart');
  if (heart) {
    e.stopPropagation();
    toggleFavorite(heart.dataset.fav, heart);
    return;
  }
  const card = e.target.closest('.product-card');
  if (!card) return;
  openCustomizer(card.dataset.id);
});

/* Toggle a product's favorite state, update the heart's visual +
   a11y state, and replay the pop animation. Also refreshes the
   favorites filter count and re-renders if we're currently showing
   the favorites-only view (so un-favoriting removes the card live). */
function toggleFavorite(id, heartEl) {
  const nowFav = Store.toggleFavorite(id);
  // Update every heart for this id currently on screen (a product can
  // appear in more than one place, e.g. future "order again" rails).
  document.querySelectorAll(`.fav-heart[data-fav="${CSS.escape(id)}"]`).forEach(h => {
    h.classList.toggle('is-fav', nowFav);
    h.setAttribute('aria-pressed', String(nowFav));
    h.setAttribute('aria-label', (nowFav ? 'Remove from' : 'Add to') + ' favorites');
  });
  // Replay the burst animation on the heart the user actually tapped.
  if (heartEl && nowFav) {
    heartEl.classList.remove('burst'); void heartEl.offsetWidth;
    heartEl.classList.add('burst');
  }
  refreshFavFilterUI();
  // If the favorites-only filter is active, un-favoriting should drop
  // the card from the list immediately.
  if (state.favoritesOnly) renderMenu();
}

/* Updates the favorites-filter control's count/label wherever it
   appears (sidebar + mobile sheet). Defined here so toggleFavorite
   can call it; the filter UI that it targets is built in the filter
   feature. Safe no-op if those elements aren't present yet. */
function refreshFavFilterUI() {
  const n = Store.favoriteCount();
  document.querySelectorAll('[data-fav-count]').forEach(el => { el.textContent = n; });
  document.querySelectorAll('[data-fav-toggle]').forEach(el => {
    el.classList.toggle('has-favs', n > 0);
  });
}

/* Keyboard activation for the product cards. They're role="button"
   tabindex="0" (see renderMenu), so Enter/Space must open the
   customizer just like a click — and Space must not scroll the page. */
menuGrid.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const card = e.target.closest('.product-card');
  if (!card) return;
  e.preventDefault();
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
   cart. The header cart icon pulses to draw the eye toward where
   the item went; the source product card briefly rocks so the
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

/* opts.forceDetails — always show the modal, even for an item with no
   options to configure. Callers where the tap IS the "add" gesture
   (the menu grid, the hero favorite chip) leave this off and keep the
   quick-add shortcut below. The carousel sets it: those cards are a
   browsing prompt, so a tap should open the product and let the
   customer decide, never silently drop it in the cart. */
function openCustomizer(itemId, opts = {}) {
  const item = MENU.find(m => m.id === itemId);
  if (!item) return;
  const o = item.options || {};
  const canCustomize = optionDefs().some(def => o[def.key]);

  if (!canCustomize && !opts.editLineKey && !opts.forceDetails) {
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
  // "Customize" is a lie for an item with nothing to configure (a
  // cookie, a croissant) — reachable now that the carousel opens the
  // modal for those too. It's a plain product view in that case.
  $('#czTitle').textContent = opts.editLineKey ? 'Edit item'
    : (canCustomize ? 'Customize' : item.name);

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
  // Staff browse the customer view to check the menu, but an order
  // placed under an admin session has no customer to attribute it to.
  // Hiding the button isn't enough — guard the action itself.
  if (Store.isAdmin()) {
    showToast('Staff accounts can browse but not order. Sign out to order as a customer.', 'error');
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
  // No explicit "show thanks" reset needed here — maybeShowThanks()
  // keys its lockout off the newest order's id, and this new order
  // just became the newest, so it re-arms itself automatically.
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
function resetCustomerVisitState({ hard = false } = {}) {
  clearActiveOrder();
  finishEditingOrder();
  clearCart();
  Store.clearSessionTable();
  // hard → also drop the clientId history, so a previous persona's
  // orders stop counting as "this session's" on the next sign-in.
  if (hard) Store.hardResetClientId();
  else Store.resetClientId();       // fresh device id → clean guest slate
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
  // One role at a time. ensureSignedOutForRole() gates every sign-in
  // entry point, so an admin session should already be gone by the
  // time a customer sign-in completes. This stays as a backstop for
  // any path that slips past the guard (e.g. a Google redirect-back
  // that resumed a stale session) — without it the two local caches
  // would disagree about who's signed in, which is the exact
  // confusion the guard exists to prevent.
  if (Store.getSession()) {
    console.warn('[auth] customer sign-in completed with an admin session still present — clearing it');
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

  // Whatever we do with the banner, the FAB count + thank-you
  // logic always need a tick. Also surface any status changes
  // since the last tick (same-tab admin updates, cross-tab
  // sync, or cross-device polling — they all funnel here).
  refreshMyOrdersFab();
  maybeShowThanks();
  reactToCustomerOrderChanges();

  // The strip is purely the best-seller carousel now (live order status
  // moved to the My Orders pill's badge), so it no longer hides when
  // there's no active order — showing the shop's best picks to someone
  // who hasn't ordered YET is the whole point of it.
  showBestSellerCarousel();

  // If the placed modal is currently visible, sync its status too.
  // Guarded on `order`: this function no longer bails early when there
  // isn't one (the carousel below shows regardless), and
  // updatePlacedModalForOrder dereferences order.status straight away.
  if (order && $('#orderPlacedModal').classList.contains('open')) {
    updatePlacedModalForOrder(order);
  }
}

function openOrderPlacedModal(order) {
  updatePlacedModalForOrder(order);
  openModal('#orderPlacedModal');
  // Fresh placement = the emotional peak of the flow. Play the
  // one-shot celebration (tick spring, number count-up, confetti,
  // staggered rise-in). Reopening this modal from the status banner
  // goes through updatePlacedModalForOrder directly and never
  // celebrates again.
  playPlacedCelebration(order);
}

/* The order-placed celebration. Additive and self-cleaning: toggles
   .celebrate on the card to drive the CSS choreography, counts the
   order number up, and bursts confetti. Honors reduced-motion by
   resolving straight to the final state. */
let placedCelebrateTimer = null;
function playPlacedCelebration(order) {
  const card   = $('#placedTickIcon').closest('.placed-card');
  const numEl  = $('#placedOrderNumber');
  if (!card || !numEl) return;

  const reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Restart cleanly if a previous celebration is mid-flight.
  clearTimeout(placedCelebrateTimer);
  card.classList.remove('celebrate');
  void card.offsetWidth;                    // reflow so the animation re-fires

  const finalNumber = order.number;
  if (reduce) {
    numEl.textContent = finalNumber;
    return;                                 // no motion, no confetti
  }

  card.classList.add('celebrate');
  launchPlacedConfetti();
  countUpNumber(numEl, finalNumber, 650, 520);   // (el, target, duration, startDelay)

  // Strip the class once the longest delay + duration has elapsed so
  // the modal returns to its resting state (and can celebrate again
  // on the next order).
  placedCelebrateTimer = setTimeout(() => card.classList.remove('celebrate'), 1500);
}

/* Count an integer up to `target` over `duration` ms, easing out, after
   an optional `delay` (synced to when the number rises into view). */
function countUpNumber(el, target, duration = 600, delay = 0) {
  const t = Number(target);
  if (!Number.isFinite(t) || t <= 0) { el.textContent = target; return; }
  const run = () => {
    const start = performance.now();
    const from  = Math.max(0, Math.floor(t * 0.4));   // start partway, not from 0
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);            // ease-out cubic
      el.textContent = Math.round(from + (t - from) * eased);
      if (p < 1) requestAnimationFrame(step);
      else       el.textContent = t;                   // land exact
    };
    requestAnimationFrame(step);
  };
  el.textContent = Math.max(0, Math.floor(t * 0.4));
  delay > 0 ? setTimeout(run, delay) : run();
}

/* Confetti fan for the placed card — a tighter, classier burst than
   the full thank-you takeover. Bits radiate up-and-out from behind
   the tick, then fall + fade. Pure CSS animation via per-bit vars. */
function launchPlacedConfetti() {
  const host = $('#placedConfetti');
  if (!host) return;
  host.innerHTML = '';
  const colors = ['#C18F1E', '#3A6E3B', '#E8B84B', '#B5652F', '#E8BE96', '#8A4A1F'];
  const N = 26;
  for (let i = 0; i < N; i++) {
    const bit = document.createElement('span');
    bit.className = 'pc-bit';
    // Fan across a 200° arc, biased upward; distance + fall vary per bit.
    const ang  = (-190 + Math.random() * 200) * Math.PI / 180;
    const dist = 60 + Math.random() * 70;
    const x = Math.cos(ang) * dist;
    const y = Math.sin(ang) * dist + (40 + Math.random() * 50);  // gravity pulls down
    bit.style.setProperty('--x', `${x.toFixed(0)}px`);
    bit.style.setProperty('--y', `${y.toFixed(0)}px`);
    bit.style.setProperty('--r', `${Math.round(Math.random() * 540 - 270)}deg`);
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = (Math.random() * 0.12 + 0.15) + 's';
    if (i % 4 === 0) bit.style.borderRadius = '50%';
    host.appendChild(bit);
  }
  setTimeout(() => { host.innerHTML = ''; }, 1400);
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
   BEST-SELLER CAROUSEL  (under the topbar)
   An auto-scrolling Top-10 strip, shown while this session has an
   order in flight. Tapping a card opens that product. Live order
   status isn't shown here — it lives on the My Orders pill's count
   badge instead.
   ========================================================== */
const OSB_SLIDE_MS = 3000;     // carousel auto-advance cadence
let osbAutoTimer   = null;

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
  // data-rank drives the top-3 gold/silver/bronze label tint in CSS.
  track.innerHTML = getBestSellers(10).map((m, i) => `
    <button type="button" class="osb-card" data-id="${escapeHtml(m.id)}" data-rank="${i + 1}">
      <span class="osb-thumb">${thumbMarkup(m, { alt: m.name })}</span>
      <span class="osb-info">
        <span class="osb-rank">#${i + 1} Best seller</span>
        <span class="osb-name">${escapeHtml(m.name)}</span>
      </span>
      <span class="osb-price">${peso(m.price)}</span>
    </button>`).join('');
}

/* Reveal + populate the strip, idempotently — safe to call on every
   poll tick. Renders and starts autoplay only on the first call, so a
   later tick never restarts the scroll out from under the customer.
   Re-renders when the ranking data changes (see renderBestSellerCarousel
   callers) rather than on a timer. */
function showBestSellerCarousel() {
  const banner = $('#orderStatusBanner');
  if (!banner) return;
  const wasHidden = banner.hidden;
  banner.hidden = false;
  if (wasHidden) {
    renderBestSellerCarousel();
    osbAutoplayStart();
  }
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

/* Carousel card → open that product. Pause autoplay while the user is
   hovering/touching so it doesn't slide out from under their tap. */
const osbTrackEl = $('#osbTrack');
if (osbTrackEl) {
  let dragging = false, dragMoved = false, startX = 0, startScroll = 0, dragPointer = null;
  let lastX = 0, dragTravel = 0;

  /* Wrap a scroll position around the ends so the strip behaves as a
     loop: dragging past the last pick continues into the first, and
     vice versa. (A true clone-based infinite track would keep the
     motion seamless, but that fights the click-to-open handler and the
     autoplay's scrollTo — for a 10-card strip a wrap is the honest
     trade: same "never hits a wall" feel, no duplicate cards.) */
  const osbWrap = (pos) => {
    const max = osbTrackEl.scrollWidth - osbTrackEl.clientWidth;
    if (max <= 0) return 0;
    if (pos > max) return pos - max;    // past the end → back to the start
    if (pos < 0)   return max + pos;    // before the start → round to the end
    return pos;
  };

  osbTrackEl.addEventListener('click', (e) => {
    // Swallow the click that ends a drag so it doesn't open a product.
    if (dragMoved) { e.preventDefault(); e.stopPropagation(); return; }
    // setPointerCapture (below) retargets events to the TRACK, so
    // e.target is the track itself rather than the card under the
    // cursor — closest() alone would find nothing and the tap would
    // silently do nothing. Fall back to hit-testing the point.
    let card = e.target.closest && e.target.closest('.osb-card');
    if (!card) {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      card = hit && hit.closest && hit.closest('.osb-card');
    }
    if (!card) return;
    // Always show the product first — a tap here is "tell me more",
    // not "add this" (see forceDetails in openCustomizer).
    openCustomizer(card.dataset.id, { forceDetails: true });
  });

  // Desktop mice only have a vertical wheel — translate it to horizontal
  // scroll so the carousel is reachable without a trackpad.
  osbTrackEl.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;   // already horizontal intent
    e.preventDefault();
    osbTrackEl.scrollLeft = osbWrap(osbTrackEl.scrollLeft + e.deltaY);
    osbAutoplayStop();
  }, { passive: false });

  // Click-and-drag to scroll (mouse / pen). Touch keeps native swipe.
  osbTrackEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    dragging = true; dragMoved = false;
    startX = e.clientX; startScroll = osbTrackEl.scrollLeft;
    lastX = e.clientX; dragTravel = 0;
    dragPointer = e.pointerId;
    try { osbTrackEl.setPointerCapture(dragPointer); } catch (_) {}
    osbTrackEl.classList.add('dragging');
    osbAutoplayStop();
  });
  osbTrackEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    // Accumulate travel separately from dx: the wrap below re-anchors
    // startX, which would otherwise reset dx to ~0 mid-drag and let a
    // long wrapping drag end in a stray click-to-open.
    dragTravel += Math.abs(e.clientX - lastX);
    lastX = e.clientX;
    if (dragTravel > 4) dragMoved = true;
    const next = osbWrap(startScroll - dx);
    // Re-anchor the drag origin on wrap, so the pointer stays "stuck"
    // to the strip instead of the cards racing back under the cursor.
    if (Math.abs(next - (startScroll - dx)) > 1) {
      startX = e.clientX;
      startScroll = next;
    }
    osbTrackEl.scrollLeft = next;
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
    // Badge shows from the FIRST pending order — it's the customer's
    // "you have something in flight" signal now that the status
    // banner's arrow is gone, so hiding it at a count of 1 would hide
    // it exactly when it matters most.
    if (badge) { badge.textContent = active; badge.hidden = false; }
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
   "round". The "already shown" flag is keyed by the newest order id
   in the customer's history and persisted to localStorage (not just
   an in-memory var) — otherwise a page reload/refresh wipes the flag
   and the overlay pops right back up on the very next poll tick,
   forever, since the underlying "0 active, 1+ served" condition
   never changes on its own. Keying by order id (rather than a plain
   boolean) still re-arms it correctly the moment a genuinely new
   order is placed. */
const THANKS_SHOWN_KEY = 'bossb_thanks_shown_for';
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
  const newestId = mine[0] && mine[0].id;
  const alreadyShown = newestId && localStorage.getItem(THANKS_SHOWN_KEY) === newestId;
  if (active === 0 && anyServed && !alreadyShown) {
    if (newestId) localStorage.setItem(THANKS_SHOWN_KEY, newestId);
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
  const colors = ['#C18F1E', '#B5652F', '#3A6E3B', '#E8B84B', '#8A4A1F', '#E8BE96'];
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

   Crucially we leave the persisted THANKS_SHOWN_KEY in place here:
   the all-served condition is still true the instant the overlay is
   dismissed, so clearing it now would make the next banner tick
   (fired on scroll/poll, or a page reload) immediately re-show the
   overlay in a loop. maybeShowThanks() only re-arms once the newest
   order id actually changes — i.e. the customer places a NEW order
   (see placeOrder) — which is the real start of a fresh round. */
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
  localStorage.removeItem(THANKS_SHOWN_KEY);
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
   ROLE-SWITCH GUARD
   Admin and customer share ONE Supabase Auth session (a single `sb`
   client holds a single session), so signing into a second role
   silently overwrites the first role's real credential — while the
   two local caches (bb_session / bb_customer) carry on as if both
   were still valid. That mismatch is what made switching accounts
   behave erratically.

   Rather than let a second sign-in start and clean up afterward,
   every sign-in entry point calls this FIRST. It returns true when
   the caller may proceed (nobody else is signed in, or the user
   agreed to sign the other role out), false to abort.
   ========================================================== */
async function ensureSignedOutForRole(targetRole) {
  const adminSession = Store.getSession();
  const customer     = Store.getCustomer && Store.getCustomer();

  // Signing into the role that's ALREADY active isn't a conflict —
  // the caller's own flow handles a re-login fine.
  if (targetRole === 'admin'    && !customer)     return true;
  if (targetRole === 'customer' && !adminSession) return true;

  const current = targetRole === 'admin'
    ? { label: customer.name || 'a customer account', signOut: () => {
          Store.rememberOrdersForAccount();
          Store.logoutCustomer();
          refreshProfileBtn();
        } }
    : { label: `the staff account ${adminSession.name || adminSession.email}`, signOut: () => {
          Store.logout();
          if (typeof exitAdminPanel === 'function') exitAdminPanel();
          refreshAdminHeaderBtn();
        } };

  const ok = await confirmAsk(
    `You're currently signed in as ${current.label}. You can only be signed ` +
    `into one account at a time on this device — sign out to continue?`,
    {
      title: 'Already signed in',
      confirmLabel: 'Sign out & switch',
      cancelLabel: 'Stay signed in',
    }
  );
  if (!ok) return false;

  current.signOut();
  // logout()/logoutCustomer() clear the shared Supabase session
  // asynchronously (fire-and-forget). Give that a beat to land so the
  // next sign-in isn't racing the sign-out it depends on.
  await new Promise(r => setTimeout(r, 150));
  return true;
}

/* ==========================================================
   STAFF LOGIN
   ========================================================== */
const staffLoginModal = $('#staffLoginModal');
function openStaffLogin()  { openModal('#staffLoginModal'); }
function closeStaffLogin() {
  closeModal('#staffLoginModal');
  $('#staffLoginError').hidden = true;
}
wirePasswordToggle('#staffLoginPasswordToggle', '#staffLoginPassword');
/* Footer button is dual-purpose: when no admin session is
   active it opens Staff Login; when one IS active it signs
   out instead — so a logged-in admin can never accidentally
   "log in again" from the customer view. */
$('#openStaffLoginBtn').addEventListener('click', async () => {
  if ($('#openStaffLoginBtn').dataset.mode === 'signout') {
    adminSignOut();
    return;
  }
  // Stop a signed-in customer from starting a staff sign-in that
  // would silently clobber their session (see ensureSignedOutForRole).
  if (!(await ensureSignedOutForRole('admin'))) return;
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

/* Shared tail of every successful staff sign-in (password or Google):
   greet, close whatever's open, hand off/clear any signed-in customer
   persona on this device, sever the guest visit, and enter the panel. */
function completeStaffSignIn(session) {
  showToast(`Welcome, ${session.name}`, 'success');
  closeStaffLogin();
  closeTableModal();
  // One role at a time. ensureSignedOutForRole() normally clears the
  // customer before the staff sign-in even starts; this is the
  // backstop for paths that reach here without passing the guard
  // (mirrors resumeOrClearOnLogin's, in the other direction).
  if (Store.getCustomer()) {
    Store.rememberOrdersForAccount();
    Store.logoutCustomer();
    if (typeof refreshProfileBtn === 'function') refreshProfileBtn();
  }
  // Sever the guest persona entirely: clear the table name + active
  // orders and mint a fresh clientId so the previous guest's visit
  // doesn't linger under the admin (those orders stay in the panel).
  resetCustomerVisitState({ hard: true });
  enterAdminPanel(session);
}

$('#staffLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#staffLoginError');
  errEl.hidden = true;
  const fd = new FormData(e.target);
  try {
    await Store.seedIfEmpty();      // LOCAL mode: ensure default admin exists before hashing
    const session = await Store.login({
      email:    fd.get('email'),
      password: fd.get('password'),
    });
    e.target.reset();
    completeStaffSignIn(session);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

$('#staffGoogleSignInBtn')?.addEventListener('click', async () => {
  const errEl = $('#staffLoginError');
  errEl.hidden = true;
  try {
    // Redirects the whole page to Google; nothing after this line runs
    // in the current page load. The return trip is handled by
    // resumeAuthSession()'s staff branch + the authResume.staff block
    // in boot() below.
    await Store.loginStaffWithGoogle();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

/* ==========================================================
   STAFF INVITE CODE  (Google sign-in, first time only — the
   Supabase Auth session from resumeAuthSession()'s staff branch is
   held here until the code is confirmed or the admin cancels)
   ========================================================== */
let pendingStaffGoogleAuth = null;   // { authSession, pendingEmail }

function openStaffInvite({ authSession, pendingEmail }) {
  pendingStaffGoogleAuth = { authSession, pendingEmail };
  $('#staffInviteEmailNote').textContent = `Signed in with Google as ${pendingEmail}. Enter the staff invite code to finish creating this admin account.`;
  $('#staffInviteError').hidden = true;
  $('#staffInviteForm').reset();
  openModal('#staffInviteModal');
}
function closeStaffInvite(abandon) {
  closeModal('#staffInviteModal');
  if (abandon && pendingStaffGoogleAuth) Store.abandonStaffGoogleSignIn();
  pendingStaffGoogleAuth = null;
}
$('#closeStaffInviteBtn').addEventListener('click', () => closeStaffInvite(true));
bindBackdropClose('#staffInviteModal', () => closeStaffInvite(true));

$('#staffInviteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#staffInviteError');
  errEl.hidden = true;
  if (!pendingStaffGoogleAuth) return closeStaffInvite(false);
  const fd = new FormData(e.target);
  try {
    const session = await Store.completeStaffGoogleSignIn(pendingStaffGoogleAuth.authSession, fd.get('inviteCode'));
    pendingStaffGoogleAuth = null;
    closeStaffInvite(false);
    completeStaffSignIn(session);
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

$('#profileBtn').addEventListener('click', async () => {
  if (Store.isCustomer()) return openProfile();
  // Stop an admin from starting a customer sign-in that would
  // silently clobber their staff session (both share one Supabase
  // session — see ensureSignedOutForRole).
  if (!(await ensureSignedOutForRole('customer'))) return;
  openCustomerLogin();
});
$('#closeCustomerLoginBtn').addEventListener('click', closeCustomerLogin);
$('#closeProfileBtn').addEventListener('click', closeProfile);
bindBackdropClose('#customerLoginModal', closeCustomerLogin);
bindBackdropClose('#profileModal', closeProfile);

/* Password show/hide toggle — shared pattern for any .field-icon
   password field with a .field-toggle button as its sibling. */
function wirePasswordToggle(toggleSel, inputSel) {
  const toggle = $(toggleSel), input = $(inputSel);
  if (!toggle || !input) return;
  toggle.addEventListener('click', () => {
    const showing = toggle.getAttribute('aria-pressed') === 'true';
    toggle.setAttribute('aria-pressed', String(!showing));
    toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    toggle.textContent = showing ? 'Show' : 'Hide';
    input.type = showing ? 'password' : 'text';
  });
}
wirePasswordToggle('#customerLoginPasswordToggle', '#customerLoginPassword');

$('#googleSignInBtn')?.addEventListener('click', async () => {
  const errEl = $('#customerLoginError');
  errEl.hidden = true;
  try {
    // Redirects the whole page to Google; nothing after this line
    // runs in the current page load. The return trip is handled by
    // resumeAuthSession() + the freshOAuth block in boot().
    await Store.loginCustomerWithGoogle();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

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
    if (cust.pendingDeletion != null) promptCancelDeletion(cust.pendingDeletion);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

/* ==========================================================
   FORGOT / RESET PASSWORD
   "Forgot password?" sends a Supabase reset-link email using
   whatever's currently typed in the login form's email field.
   Clicking that email link lands back here with a recovery
   session already active (see Store.resumeAuthSession +
   boot()'s passwordRecovery branch), which opens this modal.
   ========================================================== */
// Matches the Supabase "Minimum interval per user" SMTP setting (59s).
// Kept a hair under a full minute so the client countdown clears just
// as the server's window opens, not after it.
const RESET_COOLDOWN_SECONDS = 59;

/* Disable a button and tick down a "Try again in Ns" label until the
   cooldown elapses, then restore it. Self-clears.

   The cooldown is per-email (that's how the server throttles), so if
   `cancelOnField` is given we cancel early the moment its value
   changes — a different address isn't subject to the previous one's
   wait. That listener is attached ONLY for the cooldown's lifetime and
   removed when it ends, so nothing is monitored during normal use. */
function startButtonCooldown(btn, seconds, restoreLabel, cancelOnField) {
  if (btn._cooldownCleanup) btn._cooldownCleanup();   // supersede any running one
  let left = Math.max(1, Math.ceil(seconds));

  const end = () => {
    clearInterval(timer);
    if (cancelOnField && onEdit) cancelOnField.removeEventListener('input', onEdit);
    btn._cooldownCleanup = null;
    btn.disabled = false;
    btn.textContent = restoreLabel;
  };
  btn._cooldownCleanup = end;

  const onEdit = cancelOnField
    ? (() => { const startVal = cancelOnField.value; return () => { if (cancelOnField.value !== startVal) end(); }; })()
    : null;
  if (onEdit) cancelOnField.addEventListener('input', onEdit);

  btn.disabled = true;
  btn.textContent = `Try again in ${left}s`;
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) end();
    else btn.textContent = `Try again in ${left}s`;
  }, 1000);
}

$('#forgotPasswordBtn')?.addEventListener('click', async () => {
  const errEl = $('#customerLoginError');
  errEl.hidden = true;
  const email = $('#customerLoginForm input[name="email"]').value;
  if (!email) {
    errEl.textContent = 'Enter your email above first, then tap "Forgot password?"';
    errEl.hidden = false;
    return;
  }
  const btn = $('#forgotPasswordBtn');
  const emailField = $('#customerLoginForm input[name="email"]');
  const original = btn.dataset.label || (btn.dataset.label = btn.textContent);
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await Store.requestPasswordReset(email);
    showToast(`If an account exists for ${email}, a reset link is on its way.`, 'success');
    // Cool the button down so the user doesn't hammer it into the
    // server's per-user interval (which would 429 the next tap). Cancels
    // early if they switch to a different email.
    startButtonCooldown(btn, RESET_COOLDOWN_SECONDS, original, emailField);
  } catch (err) {
    if (err.rateLimited) {
      const wait = err.retryAfter || RESET_COOLDOWN_SECONDS;
      errEl.textContent = `You just requested a reset — please wait ${wait}s before trying again.`;
      errEl.hidden = false;
      startButtonCooldown(btn, wait, original, emailField);
    } else {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false; btn.textContent = original;
    }
  }
});

function openResetPasswordModal() {
  $('#resetPasswordError').hidden = true;
  $('#resetPasswordSuccess').hidden = true;
  $('#resetPasswordForm').reset();
  openModal('#resetPasswordModal');
}
function closeResetPasswordModal() { closeModal('#resetPasswordModal'); }
$('#closeResetPasswordBtn').addEventListener('click', closeResetPasswordModal);
bindBackdropClose('#resetPasswordModal', closeResetPasswordModal);

$('#resetPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#resetPasswordError');
  const okEl  = $('#resetPasswordSuccess');
  errEl.hidden = true; okEl.hidden = true;
  const fd = new FormData(e.target);
  try {
    await Store.completePasswordReset(fd.get('password'));
    okEl.textContent = 'Password updated — you can now sign in with it.';
    okEl.hidden = false;
    setTimeout(() => { closeResetPasswordModal(); }, 1400);
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
  // hard: rememberOrdersForAccount() just persisted this visit's ids to
  // the account's perks, so resumeAccountOrders() can still find them on
  // the next sign-in. The device itself must forget them, or the next
  // account to sign in here sees them as "this session's" orders.
  resetCustomerVisitState({ hard: true });
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

  renderDeletionState();
}

/* Shows either the "Delete my account" link or, when a deletion is
   already pending, a countdown + "Cancel deletion" button in its
   place. Called whenever the profile modal is (re)rendered. */
function renderDeletionState() {
  const daysLeft = Store.deletionDaysLeft();
  const pendingBox   = $('#deletionPending');
  const deleteBtn    = $('#deleteAccountBtn');
  if (daysLeft == null) {
    pendingBox.hidden = true;
    deleteBtn.hidden  = false;
    return;
  }
  deleteBtn.hidden  = true;
  pendingBox.hidden = false;
  $('#deletionDaysLeftText').textContent = daysLeft > 0
    ? `It will be permanently removed in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`
    : `It will be permanently removed the next time you sign in.`;
}

/* Post-sign-in nudge for an account with a pending deletion — opens
   the profile modal straight to the cancel-deletion state so it
   can't be missed. */
function promptCancelDeletion(daysLeft) {
  openProfile();
  showToast(
    daysLeft > 0
      ? `This account is scheduled for deletion in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`
      : `This account is scheduled for deletion very soon.`,
    'error'
  );
}

$('#deleteAccountBtn').addEventListener('click', async () => {
  const typed = await uiPrompt({
    title: 'Delete your account?',
    message: `Your account, points, and vouchers will be scheduled for deletion. `
      + `You'll have ${Store.DELETION_GRACE_DAYS} days to change your mind — just sign back in and cancel it. `
      + `After that, it's gone for good.\n\nType DELETE to confirm.`,
    placeholder: 'DELETE',
    confirmLabel: 'Delete my account',
    validate: (v) => (v.toUpperCase() === 'DELETE' ? null : 'Type DELETE (all caps) to confirm'),
  });
  if (typed === null) return;
  try {
    await Store.requestAccountDeletion();
    closeProfile();
    refreshProfileBtn();
    resetCustomerVisitState();
    showToast(`Account scheduled for deletion — sign back in within ${Store.DELETION_GRACE_DAYS} days to cancel it.`, 'success');
  } catch (err) {
    showToast(err.message || 'Could not delete account', 'error');
  }
});

$('#cancelDeletionBtn').addEventListener('click', async () => {
  try {
    await Store.cancelAccountDeletion();
    renderDeletionState();
    showToast('Deletion cancelled — your account is staying put.', 'success');
  } catch (err) {
    showToast(err.message || 'Could not cancel deletion', 'error');
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

/* L1 — Session expiry watcher. While the admin panel is open we
   re-check every 30 seconds. In REMOTE mode the cached session's
   expiresAt now tracks the real Supabase JWT (~1h default lifetime,
   silently auto-refreshed by the SDK while the tab stays open) rather
   than a fabricated 8h TTL — so a cheap sync check alone would kick a
   still-validly-signed-in admin roughly every hour just because the
   local CACHE's snapshot went stale, even though the real underlying
   Supabase session is fine. So: only pay for an async check when the
   cache is actually missing or within a minute of its recorded
   expiry; if Supabase's own session is still live at that point,
   re-mint the local cache from it instead of force-closing. Only a
   real, confirmed absence of both closes the panel. LOCAL mode (no
   Supabase) has no session to re-check against, so it always takes
   the force-close path once the flat 8h TTL elapses — unchanged. */
let adminSessionWatchTimer = null;
function startAdminSessionWatcher() {
  if (adminSessionWatchTimer) return;
  adminSessionWatchTimer = setInterval(async () => {
    if (adminPanel.hidden) {
      clearInterval(adminSessionWatchTimer);
      adminSessionWatchTimer = null;
      return;
    }
    const cached = Store.getSession();
    const nearExpiry = !cached || (cached.expiresAt - Date.now()) < 60 * 1000;
    if (!nearExpiry) return;   // cheap path: still comfortably valid, nothing to do

    if (Store.tryRefreshAdminSession && await Store.tryRefreshAdminSession()) {
      return;   // Supabase's own session was still live — re-minted, stay open
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
  resetCustomerVisitState({ hard: true });
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
  const boardDefault = $('#setOrdersBoardDefault');
  if (boardDefault) boardDefault.checked = board;
  // Leaving board → make sure any select-mode leftovers don't linger.
  renderOrders();
}
$('#ordersViewList')?.addEventListener('click', () => setOrdersView('list'));
$('#ordersViewBoard')?.addEventListener('click', () => setOrdersView('board'));
// NOTE: the initial setOrdersView(ordersView) sync runs in boot(), NOT here.
// Calling it at module-parse time would execute renderOrders() before the
// admin selection-state `let`s below are initialized — a temporal-dead-zone
// ReferenceError that aborts the whole script (blanking the customer menu
// whenever there were orders to render). boot() runs after all decls exist.

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
  // rAF-driven "lazy follow": the clone eases toward the cursor (a trailing
  // delay) and tilts with its own velocity + a gentle constant wobble, so the
  // drag feels springy and wiggly rather than rigidly pinned to the pointer.
  let raf = null, tx = 0, ty = 0, cx = 0, cy = 0;

  const animateClone = (now) => {
    if (!clone) { raf = null; return; }
    const prevX = cx;
    cx += (tx - cx) * 0.18;            // lag factor → the "delay"
    cy += (ty - cy) * 0.18;
    const vx = cx - prevX;             // horizontal velocity → lean into motion
    const tilt = Math.max(-14, Math.min(14, vx * 0.9));
    const wobble = Math.sin(now / 110) * 2.4;   // ever-present jiggle
    clone.style.left = cx + 'px';
    clone.style.top  = cy + 'px';
    clone.style.transform = `rotate(${(tilt + wobble).toFixed(2)}deg) scale(1.05)`;
    raf = requestAnimationFrame(animateClone);
  };

  const clearDropTargets = () => board.querySelectorAll('.kds-col.drop-target')
    .forEach(c => c.classList.remove('drop-target'));

  const cleanup = () => {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
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
      // Seed the eased follower at the clone's real spot, then animate.
      cx = tx = r.left; cy = ty = r.top;
      raf = requestAnimationFrame(animateClone);
    }
    if (!dragging) return;
    e.preventDefault();
    // Feed the target; the rAF loop eases the clone toward it (the lag/wiggle).
    tx = e.clientX - clone._dx;
    ty = e.clientY - clone._dy;
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
  const boardDefault = $('#setOrdersBoardDefault');
  if (boardDefault) boardDefault.checked = (ordersView === 'board');
  refreshInviteCodeView();
}

/* Per-device default Orders view. Persisted via setOrdersView (localStorage),
   not part of the shop config Save, and applied live so the toggle is felt. */
$('#setOrdersBoardDefault')?.addEventListener('change', (e) => {
  setOrdersView(e.target.checked ? 'board' : 'list');
});

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

/* New staff self-register at register.html using the invite code
   above — an already-authenticated admin creating the account
   directly isn't possible anymore now that account creation goes
   through real Supabase Auth (sb.auth.signUp signs the CALLER out
   and the new person in, which would boot the admin doing the
   inviting out of their own panel). "+ Add staff account" now just
   copies the sign-up link to share instead of opening a form. */
$('#openAddStaffBtn')?.addEventListener('click', async () => {
  const link = new URL('register.html', location.href).href;
  try {
    await navigator.clipboard.writeText(link);
    showAdminToast({ title: 'Sign-up link copied — share it with the new invite code', variant: 'success' });
  } catch {
    showAdminToast({ title: link, variant: 'info' });
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
   DAILY REPORT  (branded .xlsx exporter — ExcelJS + Chart.js)
   - One row per order placed today, in a real styled Excel table.
   - A header band carries the shop logo + name/address, mirroring
     the printed receipt's identity.
   - Two chart images (orders/revenue by hour, cumulative revenue)
     are rendered off-screen with Chart.js and embedded as pictures
     — ExcelJS can't create native live Excel charts, so a rendered
     PNG is the standard approach (this is also exactly what the
     reference design does: the charts are static images, not
     interactive spreadsheet charts).
   - The data table still carries live SUM/SUMIF formulas in the
     totals rows, same as the previous CSV, so editing a row's
     status/total inside Excel keeps the totals honest.
   ========================================================== */
const REPORT_BRAND_COLOR = '#B5652F';   // matches --primary in style.css
const REPORT_BRAND_DEEP  = '#8A4A1F';   // matches --primary-deep

function todaysOrdersForReport() {
  const orders = Store.getOrders();
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const sameDay = (iso) => {
    if (!iso) return false;
    const t = new Date(iso);
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  };
  return { now, todays: orders.filter(o => sameDay(o.placedAt)) };
}

/* Renders a Chart.js chart to an off-screen canvas (never attached
   to the DOM — just used as a drawing surface) and resolves a PNG
   data URL. Chart.js needs a real layout pass, so the canvas is
   given fixed pixel dimensions rather than relying on CSS sizing. */
function renderChartToDataUrl(config, width = 640, height = 360) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const chart = new Chart(canvas, {
      ...config,
      options: {
        ...config.options,
        responsive: false,
        animation: false,
      },
    });
    // Chart.js draws synchronously when animation is disabled, but
    // yielding a frame first guarantees the canvas is fully painted
    // before we read it back as an image.
    requestAnimationFrame(() => {
      const url = canvas.toDataURL('image/png', 1.0);
      chart.destroy();
      resolve(url);
    });
  });
}

/* Builds the two report charts from today's orders:
   - Bar: orders placed + revenue, grouped by hour of day.
   - Line: cumulative revenue running total through the day.
   Returns { ordersByHourUrl, cumulativeUrl } (data URLs), or null
   values if there's no data to chart. */
async function buildDailyReportCharts(todays) {
  if (!todays.length) return { ordersByHourUrl: null, cumulativeUrl: null };

  const byHour = Array.from({ length: 24 }, () => ({ count: 0, revenue: 0 }));
  todays.forEach(o => {
    const hr = new Date(o.placedAt).getHours();
    byHour[hr].count++;
    byHour[hr].revenue += taxBreakdown(o.total).grand;
  });
  const usedHours = byHour
    .map((v, hr) => ({ hr, ...v }))
    .filter(v => v.count > 0);
  const hourLabel = (hr) => `${((hr % 12) || 12)}${hr < 12 ? 'am' : 'pm'}`;

  const sorted = [...todays].sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
  let running = 0;
  const cumulative = sorted.map(o => {
    running += taxBreakdown(o.total).grand;
    return running;
  });

  const [ordersByHourUrl, cumulativeUrl] = await Promise.all([
    renderChartToDataUrl({
      type: 'bar',
      data: {
        labels: usedHours.map(v => hourLabel(v.hr)),
        datasets: [
          { label: 'Orders',  data: usedHours.map(v => v.count),   backgroundColor: REPORT_BRAND_COLOR, borderRadius: 4, yAxisID: 'y' },
          { label: `Revenue (${CONFIG.currency})`, data: usedHours.map(v => Number(v.revenue.toFixed(2))), backgroundColor: '#E8B84B', borderRadius: 4, yAxisID: 'y1' },
        ],
      },
      options: {
        plugins: {
          title: { display: true, text: 'Orders & Revenue by Hour', font: { size: 16, weight: 'bold' } },
          legend: { position: 'bottom' },
        },
        scales: {
          y:  { type: 'linear', position: 'left',  beginAtZero: true, title: { display: true, text: 'Orders' } },
          y1: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: `Revenue (${CONFIG.currency})` } },
        },
      },
    }),
    renderChartToDataUrl({
      type: 'line',
      data: {
        labels: sorted.map(o => new Date(o.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
        datasets: [{
          label: `Cumulative revenue (${CONFIG.currency})`,
          data: cumulative.map(v => Number(v.toFixed(2))),
          borderColor: REPORT_BRAND_COLOR,
          backgroundColor: 'rgba(181,101,47,0.15)',
          fill: true, tension: 0.3, pointRadius: 2,
        }],
      },
      options: {
        plugins: {
          title: { display: true, text: 'Cumulative Revenue Through the Day', font: { size: 16, weight: 'bold' } },
          legend: { display: false },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 8 } },
          y: { beginAtZero: true },
        },
      },
    }),
  ]);
  return { ordersByHourUrl, cumulativeUrl };
}

/* Fetches the topbar logo as a Buffer ExcelJS can embed. Returns
   null on any failure (offline, file missing) so the report still
   generates — just without the logo image — instead of throwing. */
async function fetchLogoBuffer() {
  try {
    const res = await fetch('icon/brand-logo.png');
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch (e) {
    return null;
  }
}

async function buildDailyWorkbook() {
  const { now, todays } = todaysOrdersForReport();
  const servedToday = todays.filter(o => o.status === 'served');
  const grossAll    = todays.reduce((s, o) => s + taxBreakdown(o.total).grand, 0);
  const grossServed = servedToday.reduce((s, o) => s + taxBreakdown(o.total).grand, 0);
  const cur = CONFIG.currency || '';
  const shopName = CONFIG.businessName || CONFIG.shopName || 'OrderInn Coffee';

  const [{ ordersByHourUrl, cumulativeUrl }, logoBuffer] = await Promise.all([
    buildDailyReportCharts(todays),
    fetchLogoBuffer(),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = shopName;
  wb.created = now;
  const sheet = wb.addWorksheet('Daily Report', {
    views: [{ showGridLines: false }],
  });

  const TABLE_COLS = 10;   // A..J — matches the headers array below
  const lastColLetter = String.fromCharCode(64 + TABLE_COLS);

  // ---- Header band: logo + business identity, brand-colored ----
  // Filled per-cell (not one big merge) since the title/subtitle
  // merges below overlap the same A1:J3 range — Excel doesn't allow
  // nested/overlapping merges.
  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= TABLE_COLS; c++) {
      sheet.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB5652F' } };
    }
  }
  sheet.getRow(1).height = 22;
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 14;

  if (logoBuffer) {
    const imgId = wb.addImage({ buffer: logoBuffer, extension: 'png' });
    sheet.addImage(imgId, {
      tl: { col: 0.15, row: 0.15 },
      ext: { width: 52, height: 52 },
    });
  }

  sheet.mergeCells('B1:F2');
  const titleCell = sheet.getCell('B1');
  titleCell.value = shopName;
  titleCell.font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

  sheet.mergeCells('B3:F3');
  const subtitleCell = sheet.getCell('B3');
  subtitleCell.value = `${CONFIG.businessAddr || ''}${CONFIG.businessTin ? '  •  TIN ' + CONFIG.businessTin : ''}`.trim();
  subtitleCell.font = { size: 9, color: { argb: 'FFF4E4D6' } };
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'left' };

  sheet.mergeCells(`G1:${lastColLetter}2`);
  const reportTitleCell = sheet.getCell('G1');
  reportTitleCell.value = 'DAILY SALES REPORT';
  reportTitleCell.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  reportTitleCell.alignment = { vertical: 'middle', horizontal: 'right' };

  sheet.mergeCells(`G3:${lastColLetter}3`);
  const genCell = sheet.getCell('G3');
  genCell.value = `Generated ${now.toLocaleString()}`;
  genCell.font = { size: 9, color: { argb: 'FFF4E4D6' } };
  genCell.alignment = { vertical: 'middle', horizontal: 'right' };

  // ---- Summary stat tiles ----
  const stats = [
    ['Orders today',   todays.length],
    ['Served today',   servedToday.length],
    [`Gross all (${cur})`,    Number(grossAll.toFixed(2))],
    [`Gross served (${cur})`, Number(grossServed.toFixed(2))],
    ['Lifetime orders', CONFIG.lifetimeOrders || 0],
  ];
  const statsRow = 5;
  sheet.getRow(statsRow).height = 18;
  sheet.getRow(statsRow + 1).height = 24;
  stats.forEach((s, i) => {
    const col = i + 1; // A, B, C...
    const labelCell = sheet.getCell(statsRow, col);
    labelCell.value = s[0];
    labelCell.font = { size: 9, color: { argb: 'FF8A4A1F' }, bold: true };
    labelCell.alignment = { horizontal: 'center' };
    const valCell = sheet.getCell(statsRow + 1, col);
    valCell.value = s[1];
    valCell.font = { size: 14, bold: true, color: { argb: 'FF3A2A1E' } };
    valCell.alignment = { horizontal: 'center' };
    valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF3EA' } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4E4D6' } };
    ['top', 'bottom', 'left', 'right'].forEach(side => {
      labelCell.border = { ...labelCell.border, [side]: { style: 'thin', color: { argb: 'FFE8CBB0' } } };
      valCell.border   = { ...valCell.border,   [side]: { style: 'thin', color: { argb: 'FFE8CBB0' } } };
    });
  });
  sheet.mergeCells(statsRow, 6, statsRow, TABLE_COLS);
  sheet.mergeCells(statsRow + 1, 6, statsRow + 1, TABLE_COLS);
  const taxCell = sheet.getCell(statsRow, 6);
  taxCell.value = `Tax: ${CONFIG.taxLabel} ${CONFIG.taxRate}% (${CONFIG.taxInclusive ? 'inclusive' : 'exclusive'})`;
  taxCell.font = { size: 9, italic: true, color: { argb: 'FF8A4A1F' } };
  taxCell.alignment = { horizontal: 'left', vertical: 'middle' };

  // ---- Data table ----
  const headers = [
    'Order #', 'Location', 'Placed', 'Served', 'Status',
    'Items', 'Qty',
    `Subtotal (${cur})`, `${CONFIG.taxLabel || 'Tax'} ${CONFIG.taxRate}% (${cur})`, `Total (${cur})`,
  ];
  const headerRowIdx = statsRow + 3;
  const headerRow = sheet.getRow(headerRowIdx);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8A4A1F' } };
    c.alignment = { vertical: 'middle', horizontal: i >= 6 ? 'right' : 'left' };
    c.border = { bottom: { style: 'medium', color: { argb: 'FF5A3010' } } };
  });
  headerRow.height = 20;

  const dataStartRow = headerRowIdx + 1;
  todays.forEach((o, i) => {
    const { subtotal, tax, grand } = taxBreakdown(o.total);
    const itemsSummary = o.items
      .map(it => `${it.qty}× ${it.name}${it.summary ? ' (' + it.summary + ')' : ''}`)
      .join('; ');
    const qtyTotal = o.items.reduce((s, it) => s + it.qty, 0);
    const r = sheet.getRow(dataStartRow + i);
    const rowVals = [
      o.number, o.locationIdentifier || '', o.placedAt ? new Date(o.placedAt) : '',
      o.servedAt ? new Date(o.servedAt) : '', o.status, itemsSummary, qtyTotal,
      Number(subtotal.toFixed(2)), Number(tax.toFixed(2)), Number(grand.toFixed(2)),
    ];
    rowVals.forEach((v, ci) => {
      const c = r.getCell(ci + 1);
      c.value = v;
      c.font = { size: 10 };
      c.alignment = { vertical: 'middle', horizontal: ci >= 6 ? 'right' : 'left', wrapText: ci === 5 };
      if (ci === 2 || ci === 3) c.numFmt = 'yyyy-mm-dd hh:mm';
      if (ci >= 7) c.numFmt = `#,##0.00`;
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF3EA' } };
      const STATUS_ARGB = { pending: 'FFB88A00', preparing: 'FF2E6DB4', served: 'FF3A6E3B', cancelled: 'FFC0392B' };
      if (ci === 4 && STATUS_ARGB[v]) c.font = { ...c.font, bold: true, color: { argb: STATUS_ARGB[v] } };
    });
  });

  // ---- Totals footer (live formulas — SUM / SUMIF) ----
  let footerEndRow = dataStartRow - 1;
  if (todays.length > 0) {
    const lastDataRow = dataStartRow + todays.length - 1;
    const rng = (col) => `${col}${dataStartRow}:${col}${lastDataRow}`;
    const totalsSpecs = [
      ['ALL ORDERS',  `=SUM(${rng('G')})`, `=SUM(${rng('H')})`, `=SUM(${rng('I')})`, `=SUM(${rng('J')})`],
      ['SERVED ONLY', `=SUMIF(${rng('E')},"served",${rng('G')})`, `=SUMIF(${rng('E')},"served",${rng('H')})`, `=SUMIF(${rng('E')},"served",${rng('I')})`, `=SUMIF(${rng('E')},"served",${rng('J')})`],
      ['AVG / ORDER', null, null, null, `=IFERROR(SUM(${rng('J')})/COUNT(${rng('J')}),0)`],
    ];
    totalsSpecs.forEach((spec, i) => {
      const rowIdx = lastDataRow + 2 + i;
      const r = sheet.getRow(rowIdx);
      const labelCell = r.getCell(5);
      labelCell.value = spec[0];
      labelCell.font = { bold: true, size: 10, color: { argb: 'FF8A4A1F' } };
      [6, 7, 8, 9].forEach((col, gi) => {
        const formula = spec[gi + 1];
        if (!formula) return;
        const c = r.getCell(col);
        c.value = { formula: formula.slice(1) };
        c.numFmt = '#,##0.00';
        c.font = { bold: true, size: 10 };
        c.alignment = { horizontal: 'right' };
        c.border = { top: { style: 'thin', color: { argb: 'FFE8CBB0' } } };
      });
      footerEndRow = rowIdx;
    });
  }

  headers.forEach((_, i) => {
    const col = sheet.getColumn(i + 1);
    col.width = [10, 16, 18, 18, 12, 42, 7, 13, 16, 13][i];
  });

  // ---- Charts, embedded as images below the table ----
  let chartRow = footerEndRow + 3;
  if (ordersByHourUrl || cumulativeUrl) {
    const chartHeadCell = sheet.getCell(chartRow, 1);
    chartHeadCell.value = 'Charts';
    chartHeadCell.font = { bold: true, size: 12, color: { argb: 'FF8A4A1F' } };
    chartRow += 1;
    const imgTopRow = chartRow;
    if (ordersByHourUrl) {
      const id = wb.addImage({ base64: ordersByHourUrl, extension: 'png' });
      sheet.addImage(id, { tl: { col: 0, row: imgTopRow }, ext: { width: 420, height: 236 } });
    }
    if (cumulativeUrl) {
      const id = wb.addImage({ base64: cumulativeUrl, extension: 'png' });
      sheet.addImage(id, { tl: { col: 5.2, row: imgTopRow }, ext: { width: 420, height: 236 } });
    }
    chartRow += 14; // reserve vertical space for the images
  }

  return { workbook: wb, todayCount: todays.length, servedCount: servedToday.length };
}

$('#exportCsvBtn').addEventListener('click', async () => {
  const { todays } = todaysOrdersForReport();
  if (todays.length === 0) {
    showAdminToast({ title: 'No orders placed today yet', variant: 'info' });
    return;
  }
  const btn = $('#exportCsvBtn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Building report…';
  try {
    const { workbook, todayCount, servedCount } = await buildDailyWorkbook();
    const buffer = await workbook.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `orderinn-daily-${stamp}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showAdminToast({
      title: `Exported ${todayCount} order${todayCount === 1 ? '' : 's'} (${servedCount} served)`,
      variant: 'success',
    });
  } catch (err) {
    console.error('[export] failed to build report', err);
    showAdminToast({ title: 'Export failed — see console for details', variant: 'error' });
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
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
    renderFilters();    // categories may have changed
    renderHero();       // brand name / tagline / favorite may have changed
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
      ['bb_chat_local', 'bossb_active_order', 'bb_chat_seen', 'bb_pin_hint_seen', 'bb_dismissed_orders', 'bossb_thanks_shown_for']
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

  // Pick up a real Supabase Auth session — either one already
  // restored from its own storage (returning customer) or one just
  // delivered by the Google OAuth redirect-back landing on this page.
  // Must happen before the UI below reads Store.getCustomer()/
  // isCustomer() so a signed-in customer never flashes as signed-out.
  let authResume = { customer: null, freshOAuth: false, pendingDeletion: null };
  try { authResume = await Store.resumeAuthSession(); }
  catch (e) {
    console.warn('[boot] resumeAuthSession failed', e);
    if (/permanently deleted/i.test(e.message || '')) {
      showToast('Your account was permanently deleted after the 15-day grace period.', 'error');
    }
  }
  // Strip every OAuth-redirect marker (?code=..., ?staffAuth=1,
  // ?inviteCode=...) up front, unconditionally — regardless of which
  // branch above ran or whether it threw, so a refresh never
  // re-consumes a stale code, re-opens the staff invite prompt, or
  // leaves a plaintext invite code sitting in the address bar/history
  // after the tab reloads.
  {
    const qs = new URLSearchParams(location.search);
    if (qs.has('code') || qs.has('staffAuth') || qs.has('inviteCode')) {
      const url = new URL(location.href);
      url.searchParams.delete('code');
      url.searchParams.delete('staffAuth');
      url.searchParams.delete('inviteCode');
      history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  }

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
  // Still goes through the role-switch guard: landing here while a
  // customer is signed in is the same conflict as clicking Staff
  // Login would be.
  if (new URLSearchParams(location.search).get('staff') === '1') {
    ensureSignedOutForRole('admin').then(ok => { if (ok) openStaffLogin(); });
  } else {
    ensureTable();
  }
  syncTopbarHeight();
  // Sync the admin Orders view toggle + container visibility to the saved
  // preference. Deferred here (not at module-parse time) so the selection
  // -state declarations it transitively touches are already initialized.
  setOrdersView(ordersView);
  renderCategoryChips();
  renderFilters();
  wireFilters();
  renderHero();
  renderMenu();
  showBestSellerCarousel();   // after renderMenu — it ranks off MENU
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

  // Just landed back from the Google OAuth redirect: greet the
  // customer (the generic linking above already ran; the ?code=...
  // param was already stripped up top).
  if (authResume.freshOAuth && authResume.customer) {
    refreshProfileBtn();
    showToast(`Welcome, ${authResume.customer.name}`, 'success');
  }

  // Signed back in during the 15-day deletion grace period — offer to
  // cancel it. Runs on both a fresh Google redirect and a plain
  // restored session, so it can't be missed either way.
  if (authResume.customer && authResume.pendingDeletion != null) {
    promptCancelDeletion(authResume.pendingDeletion);
  }

  // Landed back from a "Forgot password?" reset-link email: the
  // recovery session is already active (Store.resumeAuthSession
  // detected it), so open the set-new-password modal directly rather
  // than routing through the normal login form.
  if (authResume.passwordRecovery) {
    history.replaceState({}, '', location.pathname + location.search);
    openResetPasswordModal();
  }

  // Just landed back from a STAFF Google OAuth redirect (Staff Login's
  // "Continue with Google", tagged via the ?staffAuth=1 redirect param
  // so this branch doesn't get confused with a customer sign-in
  // above). Either the Google identity matched an existing admin —
  // enter the panel straight away — or it's brand new and still needs
  // the invite code.
  if (authResume.staff) {
    if (authResume.staff.staffNeedsInviteCode) {
      openStaffInvite({ authSession: authResume.staff.authSession, pendingEmail: authResume.staff.pendingEmail });
    } else if (authResume.staff.staffSession) {
      completeStaffSignIn(authResume.staff.staffSession);
    }
  }

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
  if (topbar) {
    const h = Math.round(topbar.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--topbar-h', h + 'px');
  }
  // The sticky search bar pins below the topbar; the filter bar pins
  // below the search bar. Measure the search bar so the filter bar's
  // offset (top: topbar-h + search-h) tracks its real height.
  const search = $('.search-bar');
  if (search) {
    const sh = Math.round(search.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--search-h', sh + 'px');
  }
}
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(syncTopbarHeight);
  document.addEventListener('DOMContentLoaded', () => {
    const topbar = $('.topbar');   if (topbar) ro.observe(topbar);
    const search = $('.search-bar'); if (search) ro.observe(search);
  });
}
window.addEventListener('resize', syncTopbarHeight);

/* Back-to-top button — appears once the customer has scrolled well
   down the page (both mobile and desktop), scrolls smoothly to top on
   click. The topbar itself is a plain fixed/sticky header now (no
   hide-on-scroll, no peek-handle) — it stays visible at all times. */
(function wireBackToTop() {
  const toTop = $('#backToTop');
  if (!toTop) return;
  let ticking = false;
  const topAt = () => window.innerHeight * 0.60;
  function apply() {
    ticking = false;
    toTop.classList.toggle('show', window.scrollY > topAt());
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(apply); }
  }, { passive: true });
  window.addEventListener('resize', apply);
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
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
