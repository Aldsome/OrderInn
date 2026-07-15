---
name: OrderInn Coffee
description: Self-serve coffee shop ordering — warm, borderless, product-first
colors:
  brown-50: "#FBF3EC"
  brown-100: "#F5E1CE"
  brown-200: "#E8BE96"
  brown-300: "#D89A66"
  brown-500: "#B5652F"
  brown-700: "#8A4A1F"
  yellow-50: "#FFFBEF"
  yellow-100: "#FFF1C8"
  yellow-200: "#FFE48A"
  yellow-300: "#FFD865"
  yellow-500: "#F0BB3D"
  yellow-700: "#C18F1E"
  cream: "#FFFDF8"
  white: "#FFFFFF"
  ink: "#3D2E1F"
  ink-soft: "#5C4A39"
  ink-faint: "#837158"
  line: "#EADFCC"
  line-strong: "#DDC9A8"
  danger: "#DC3545"
  danger-deep: "#A02633"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(1.5rem, 3vw, 2.2rem)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.06em"
rounded:
  sm: "8px"
  md: "14px"
  lg: "22px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.brown-500}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "{colors.brown-700}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "11px 18px"
  button-ghost-hover:
    backgroundColor: "{colors.brown-50}"
  chip:
    backgroundColor: "{colors.brown-50}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  chip-active:
    backgroundColor: "{colors.brown-500}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
---

# Design System: OrderInn Coffee

## 1. Overview

**Creative North Star: "The Counter, Not the Kiosk"**

OrderInn Coffee should feel like ordering from a well-run neighborhood counter — warm, quick, unfussy — never like operating enterprise software. Every surface (customer menu, cart, admin queue) shares one visual language: soft brown/cream warmth, a serif display face reserved for moments that deserve it, and flat, borderless components that separate themselves with spacing and tint rather than strokes. Depth exists (a restrained shadow scale) but is used sparingly, for things that actually float above the page — modals, floating action buttons, sticky bars — not for routine buttons and chips sitting in the flow.

This system explicitly rejects the boxy, bordered-everything look of a generic admin template: visible 1–1.5px borders on buttons, chips, and icon buttons read as dated and add visual noise without adding clarity. It also rejects native, unstyled form controls (radio buttons, checkboxes) standing in as the only indicator of selection state — every selectable control must show a clear, custom-styled active/selected state independent of what the browser's default rendering happens to look like.

**Key Characteristics:**
- Borderless-by-default components; separation via background tint, spacing, and elevation only
- One warm palette (brown + yellow on cream) shared identically across customer and admin
- Serif display type for identity moments (shop name, section headers); sans body everywhere else
- Every toggle/select control (chips, filters, sort, tabs, nav) shows an unambiguous active state
- Motion is quick and functional (120–200ms), never decorative

## 2. Colors

A single warm brown-and-yellow family on a cream base — restrained, not a full multi-hue palette. Dark mode swaps the warm-tinted neutrals for a neutral gray surface while keeping the brand brown as a lightened "copper" accent, so identity survives the theme switch without becoming murky.

### Primary
- **Toasted Brown** (`#B5652F` / brown-500): the one brand color. Primary buttons, active states, links, focus-ring accent, selected chips/filters. Used deliberately, not on every element — its rarity against the cream base is what makes it read as "the brand color" rather than background noise.
- **Toasted Brown Deep** (`#8A4A1F` / brown-700): hover/pressed state for primary actions; also doubles as strong label text on tinted brown backgrounds (stat labels, active filter text).

### Secondary
- **Warm Yellow** (`#F0BB3D` / yellow-500): the accent that never competes with brown for "primary" status — used for secondary emphasis (loyalty progress fills, the "preparing" status color, chart accent series).

### Neutral
- **Cream** (`#FFFDF8` / `#121212` dark): app background. Warm-white in light mode, neutral near-black in dark mode (deliberately NOT warm-tinted dark — a warm-tinted dark background reads muddy against the copper accent).
- **White** (`#FFFFFF` / `#1E2127` dark): card/panel/surface color, one step up from the app background.
- **Ink** (`#3D2E1F` / `#ECEEF1` dark): primary text.
- **Ink Soft** (`#5C4A39` / `#BAC0C9` dark): secondary text, labels.
- **Ink Faint** (`#837158` / `#8A909B` dark): hints, timestamps, placeholder text.
- **Line** (`#EADFCC` / `#34383F` dark): the ONE place hairline borders are still allowed — dividers between distinct sections (not around individual buttons/chips/cards).

### Named Rules
**The No-Stroke Rule.** Buttons, chips, icon buttons, and filter pills never carry a visible `border`. Selection/hover/active state is shown through background-color and text-color changes only. The `--line` color is reserved for true section dividers (between a header and its content, between list rows) — never as an outline around an individual interactive control.

**The One Accent Rule.** Brown-500 is the only color that means "primary action" or "currently selected." If two different UI elements both use brown-500 fill, they both mean the same thing: this is the active/primary one.

## 3. Typography

**Display Font:** Plus Jakarta Sans (with system-ui, -apple-system, Segoe UI, Roboto, sans-serif fallback)
**Body Font:** Plus Jakarta Sans (same family, lighter weights)

**Character:** One warm humanist sans, carrying the whole system through weight alone (400 for body, 600–800 for anything that needs to lead). Plus Jakarta Sans has rounder terminals and a friendlier stroke than a cold geometric sans (Inter, Helvetica-alikes), so it keeps the "neighborhood coffee shop, not SaaS dashboard" personality without reaching for a serif. Replaces the previous Playfair Display + Poppins pairing — the serif read as decorative overhead against the cleaner, more modern reference direction the brand is moving toward.

### Hierarchy
- **Display** (800, `clamp(1.5rem, 3vw, 2.2rem)`, 1.15 line-height, -0.01em tracking): shop name in the hero, modal titles that deserve weight (order-placed celebration, login "Welcome Back"). Rare — most of the UI never touches this weight.
- **Headline** (700, 1.25rem, 1.25): section headers (Active Orders, Menu category titles).
- **Title** (600, 1.05rem, 1.3): card titles (product names, order numbers).
- **Body** (400, 1rem, 1.5): all running text, descriptions, form inputs. Cap prose at ~70ch.
- **Label** (700, 0.78rem, 1.3, 0.06em tracking, uppercase where used): filter-group headers, stat-tile labels, small status tags.

### Named Rules
**The One Family Rule.** Every weight in the system comes from Plus Jakarta Sans. No second typeface, no serif carve-out — hierarchy is built with weight, size, and color, not a face switch. This keeps the system faster to scan and easier to keep consistent across customer and admin than a two-family pairing.

## 4. Elevation

Mostly flat. Shadows are structural, not ambient decoration — they exist specifically to show that something is floating above the page (modals, the sticky topbar's subtle lift, floating action buttons, dropdown-like sheets), not to give ordinary cards a "lifted" look. Buttons and chips at rest have zero shadow.

### Shadow Vocabulary
- **shadow-sm** (`0 2px 8px rgba(61,46,31,.06)`): primary buttons only, a whisper of lift to distinguish the one "do this" action.
- **shadow** (`0 8px 24px rgba(61,46,31,.10)`): cards that are genuinely separate surfaces (product cards on hover, the cart drawer).
- **shadow-lg** (`0 20px 60px rgba(61,46,31,.22)`): modals, bottom sheets — true overlays above everything else.

### Named Rules
**The Flat-at-Rest Rule.** No card, chip, or list row carries a shadow by default. Shadows appear only on hover/press feedback or on components that are structurally an overlay (modal, sheet, dropdown, FAB).

## 5. Components

### Buttons
- **Shape:** fully pill-shaped (`border-radius: 999px`) at every size.
- **Primary:** `background: brown-500`, white text, `shadow-sm` at rest, `brown-700` on hover, no border.
- **Ghost (default secondary):** transparent background, ink-colored text, **no border**. Hover fills with `brown-50` (a soft tint) — the fill itself communicates "hoverable" instead of a stroke communicating "boxed control."
- **Danger:** `background: danger` (#DC3545), white text, `danger-deep` on hover. No border.
- **Icon buttons:** 38×38px, fully rounded corners (10px, not pill — these are squarer utility buttons), no border, transparent/white background, `brown-50` fill on hover.
- **Disabled:** 55% opacity, no transform on press.

### Chips / Filter Pills
- **Style:** pill radius, `brown-50` background at rest (never `border` + `transparent`), ink text.
- **Active/selected state:** solid `brown-500` fill, white text — unmistakable against the tinted-but-unselected siblings.
- **Category list items (sidebar):** left-aligned rows, `brown-100` tint + `brown-700` text + weight 600 when active, transparent + hover-tint otherwise. This pattern (tint + weight + color, not just a border or a lone dot) is the template every other "selected" state should follow.

### Radio / Toggle Controls (Sort, single-select filters)
- **Style:** the row itself (label) is the hit target and the visual carrier of state — not just the native input. At rest: transparent background, ink text, ink-faint radio dot. Selected: `brown-100` row background (light) / `rgba(181,101,47,.18)` (dark), `brown-700` text, weight 600, and the native radio's `accent-color` reinforces it — never relies on the native accent-color alone.
- **Why:** a bare 16px native radio with only `accent-color` set is too subtle to register as "this is the selected option" at a glance, especially in a borderless system with no surrounding box. The row-level tint is the primary signal; the radio itself is secondary confirmation.

### Cards / Containers
- **Corner Style:** `--radius` (14px) for standard cards, `--radius-lg` (22px) for hero/modal surfaces.
- **Background:** `white` token, sitting on the `cream` page background.
- **Shadow Strategy:** flat at rest; `shadow` on hover for interactive cards (product cards); no shadow at all for static content blocks (stat tiles, list rows) — those separate via background tint instead.
- **Border:** none. Where a boundary is truly needed (e.g. a dashed voucher card), express it as a deliberate dashed pattern with clear semantic purpose, not a generic 1px solid stroke.

### Inputs / Fields
- **Standard fields** (settings, admin forms): `line` colored 1.5px border is acceptable here — form inputs are the one component category where a border legitimately communicates "type here" — background `white`, radius `radius-sm`.
- **Pill fields with a leading icon** (search bar, auth-card email/password): fully rounded (`999px`), no border, `brown-50` background at rest — a left-inset icon (18px, `ink-faint`) does the "this is an input" signaling instead of a stroke. Password fields get a matching trailing icon-button (eye / eye-off) to toggle visibility, sized and positioned like the leading icon.
- **Focus:** the shared `--focus-ring` token (two-layer ring: gap in `cream`, then `primary`) — never a color-only border change alone, since that fails the visible-focus-indicator bar for low-vision users.

### Auth Card (sign in / sign up)
- **Header:** centered — a round badge carrying the actual brand logo (not initials) on a white fill, display-weight title ("Welcome back"), muted subtitle beneath, and for customer-facing sign-in specifically, a small note that signing in is optional (saves order history, unlocks promo discounts and freebies) so it never reads as a gate. No separate `.modal-head` bar with a close button; the whole card reads as one composed moment.
- **Fields:** the pill-with-icon style above, stacked with generous gap (14–16px), no visible `<label>` text — placeholder communicates the field. Every field icon (mail, lock, person, key) is the same hollow-outline SVG style — `stroke: currentColor`, no fill — so leading field icons and the trailing password toggle read as one consistent icon language.
- **Password toggle:** a key icon (not an eye) in the trailing position, matching the leading lock icon's outline style; toggles the field's `type` and tints `primary` when active. Chrome's own built-in password-reveal control is explicitly suppressed (`data-pw-enhanced` + `::-webkit-textfield-decoration-container`) so only this one control ever shows.
- **Row below fields:** "Remember me" (the shared custom checkbox) on the left, "Forgot password?" as a text link on the right, same line.
- **Primary action:** full-width pill button, `brown-500` fill — the same primary color as everywhere else in the system (no scoped exception).
- **Secondary provider button** (Google): sits BELOW the primary action, separated by an `.auth-divider` ("or"), not above it.
- **Footer:** centered small text linking to the alternate flow ("Don't have an account? Sign up").

### Navigation
- **Topbar:** sticky, flat, `cream`-toned translucent background with backdrop-blur, a single `line`-colored bottom hairline (the one acceptable full-width divider, not a per-element border) — no per-button borders inside it, only icon-buttons with hover-tint.
- **Mobile bottom nav (reference pattern to adopt where a persistent nav is needed):** a floating pill-shaped bar, borderless, icon-only buttons at rest with a label appearing above the focused/hovered icon — separation from the page via `shadow` elevation, not a border.

## 6. Do's and Don'ts

### Do:
- **Do** use pill radius (999px) for every button and chip, and 10px for icon-buttons.
- **Do** show selection/active state through background-fill + text color/weight change (tint → solid-fill progression), matching the existing `.filter-cat.active` pattern.
- **Do** reserve shadows for genuine overlays (modals, sheets, FABs) and the one primary-button whisper-shadow.
- **Do** keep the `--focus-ring` token on every interactive element — borderless does not mean focus-less.
- **Do** apply the same button/chip/card system identically in the admin panel and the customer view; admin may be denser (tighter padding, smaller type) but never a different visual language.

### Don't:
- **Don't** put a visible `border` on `.btn-ghost`, `.icon-btn`, or `.chip` — these are the exact outdated pattern being removed. Replace with transparent-at-rest + tint-on-hover.
- **Don't** rely on a bare native `<input type="radio">`/`accent-color` as the only signal of a selected option — always pair it with a row/label-level background or text treatment.
- **Don't** add borders to cards or list rows as a substitute for spacing or tint — this is the "boxy admin template" look explicitly being moved away from.
- **Don't** introduce a second accent color for "selected" states — brown-500 solid fill is the one selection language across chips, filters, sort, tabs, and category rows.
- **Don't** introduce a second typeface anywhere — Plus Jakarta Sans covers display through label weights; reach for weight/size, not a face switch, when something needs to stand out.
