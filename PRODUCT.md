# Product

## Register

product

## Users

Two distinct groups on the same codebase:
- **Customers** — walk-in café patrons ordering from a shared in-store device or their own phone (session-based, no table assignment). Casual, often mid-conversation or in a queue; need to scan the menu, order, and track status fast with minimal friction.
- **Staff/admin** — baristas and shop owners running the counter. Data-dense workflows: live order queue, menu/inventory edits, daily sales reports, customer accounts. Need speed and clarity over polish; this is a tool they use dozens of times a shift.

## Product Purpose

OrderInn Coffee is a self-serve ordering system for a coffee shop: customers browse the menu and place orders from a device in-store (or their own phone via QR), staff manage the live order queue and menu from an admin panel. Success = fast, unambiguous ordering with zero training needed, and an admin panel staff can operate one-handed during a rush.

## Brand Personality

Warm, approachable, unfussy — a neighborhood coffee shop, not a chain. Confident but quiet: the product should feel considered without competing for attention against the menu items themselves. Leans product over brand: clarity and speed win over visual flourish, but retains warmth (the existing brown/cream palette, Playfair display headlines) so it doesn't read as a generic dashboard.

## Anti-references

- Bordered, boxy buttons that look like a stock admin template (the exact thing being fixed right now).
- Cluttered dashboards with visible borders on every card/section — recent references (foodpanda header, pill-shaped bottom nav) favor flat, borderless surfaces with spacing and subtle hover/active states doing the separation work instead of strokes.
- Anything that makes the customer-facing menu feel like enterprise software.

## Design Principles

- **Borderless over bordered.** Separation comes from spacing, background-tint, and elevation (shadow) — not visible strokes. Applies across customer and admin for one consistent system.
- **State must be legible.** Any selectable/toggleable control (filters, sort, tabs, nav) has to show its current selection unambiguously — this was failing (sort radio didn't visibly indicate the active mode) and is a running principle, not just a one-off fix.
- **One system, two densities.** Same tokens, radii, and component patterns everywhere; admin is allowed to be denser (tighter spacing, smaller type) but never a different visual language than the customer view.
- **Speed reads as confidence.** Motion and feedback (hover, press, toasts) should feel immediate and light — never decorative delay.
- **Product first, brand second.** Warmth and identity (color, display type) are seasoning, not the main structure. When in doubt, favor the clearer/faster option.

## Accessibility & Inclusion

Existing baseline already in place and must be preserved: a shared `--focus-ring` token with visible `:focus-visible` states on all interactive elements, `prefers-reduced-motion` alternatives on every animation, sufficient color contrast (dark mode uses a neutral gray + copper accent specifically chosen for legibility over a warm-tinted dark surface). No new component should regress these.
