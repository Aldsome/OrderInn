# BossB Coffee Shop — Phase 2 Plan

Phase 1 (shipped, commit `c8e82b4`) stabilized guest identity: clientId
history, room-abolish-on-completion (chat thread cleared), the "It's me"
reclaim path, current-table-scoped order bubble, and device-deduped headcount.

Phase 2 builds the feature backlog on top of a foundational data-model change.

---

## 0. Foundational: decouple identity from location

**Decision (brainstorm result):** today `tableNumber` is a single field that
doubles as *who you are* and *where you sit*, which is why "same device,
different table" is ambiguous and why orders get orphaned when a guest moves.

Split it:

- **Name = identity ("the tab").** Chat thread, orders, table PIN, and the
  "people here" headcount all key on the **name**. It follows the person/device,
  not the seat.
- **Table = a separate, mutable delivery field.** Optional; can be prefilled by
  the `?table=` QR. Changing it just updates a field — **no new room, no
  orphaned orders.**

Why: "move table" becomes a trivial field edit (orders stay with you), the
false-order bubble becomes structurally impossible, and it matches reality
(the phone belongs to a person, not a chair).

Tradeoff: names collide more than table numbers. Already mitigated by the
Phase 1 collision + reclaim/PIN logic; the table field is a natural staff
tiebreaker.

**Touch points:** order shape (add identity/name distinct from a `table`
delivery field), chat thread key, session key, the collision logic in
`checkDuplicateTable`, admin Orders display (show name + table), and
receipts/CSV. This lands first because the features below get simpler once
identity ≠ location.

---

## Feature backlog

1. **Modify already-placed orders** (customer + admin) — allowed only before the
   order is marked `preparing`. Customer's Modify button shares the existing
   60s cancel-grace countdown; admin can modify any still-`pending` order.
2. **Move table / change name when available** — now trivial given item 0:
   editing the table field carries orders automatically. (The original
   "declining to move cancels all orders" rule is largely moot once orders
   follow the name; keep a confirm only for an actual *name* change.)
3. **Cancel all orders at once** + checkbox multi-select to clear "my orders"
   list (customer).
4. **Admin checkbox multi-select** on the Orders list and Menu table for batch
   delete.
5. **Admin menu category grouping** — group menu items by category in the admin
   Menu view.
6. **Admin category filter chips** + ability to add new categories (categories
   become data-driven in config instead of the hardcoded
   coffee/tea/cold/pastry set in `index.html` chips and the item-modal
   `<select>`).
7. **Show PIN on order creation** + remind the customer to write it down before
   changing/modifying name or moving table (the welcome-back / reclaim code).
8. **Customer "Modify" button** sharing the cancel-button countdown (see item 1).
9. **Admin "Reset all settings to default"** — full blank slate: regular
   accounts, all orders, chat logs, activity log, settings. (Distinct from the
   existing factory reset, which is local-only; this should also clear the
   synced Supabase tables.)

## Carried over from Phase 1
- **Persistent welcome-back code / lightweight account** for true
  cross-cache-clear identity (a full cache wipe still looks like a new device).
  Item 7's PIN is the lightweight version of this.
