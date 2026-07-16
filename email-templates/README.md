# OrderInn Coffee — branded auth emails

Custom HTML for the Supabase Auth emails so they carry the OrderInn
brand (logo, name, brown accent) instead of Supabase's plain default.

## Files

| File | Paste into Supabase → Authentication → Emails → Templates → |
|------|------|
| `reset-password.html` | **Reset Password** |
| `confirm-signup.html` | **Confirm signup** |
| `magic-link.html` | **Magic Link** |
| `_shared.html` | (reference only — do not paste) |

## Step 1 — host the logo at a public URL

Inboxes can't load `icon/brand-logo.png` (a local path). The `<img>`
needs an absolute `https://` URL. Easiest free option using the
Supabase you already have:

1. Supabase dashboard → **Storage** → **New bucket** → name it
   `public` → toggle **Public bucket** ON → create.
2. Open the bucket → **Upload file** → upload `icon/brand-logo.png`.
3. Click the file → **Copy URL**. It looks like:
   `https://rpjlaaudtuaaycfmpoxy.supabase.co/storage/v1/object/public/public/brand-logo.png`

That URL is your `LOGO_URL`.

> Tip: a square PNG ~112×112px (2× the 56px display size) looks
> crispest on high-DPI screens. `brand-logo.png` is fine as-is.

## Step 2 — paste each template

For each file above:

1. Open it, **Find & Replace** every `LOGO_URL` with the URL from
   step 1 (there is one per file).
2. Copy the whole file.
3. In the dashboard, open the matching template, switch the editor to
   **HTML / source** (not the visual editor), paste, and **Save**.

Leave the `{{ .ConfirmationURL }}` variables exactly as they are —
Supabase fills them in when it sends.

## Step 3 — test

Trigger each flow against a real inbox:

- Reset: use the app's **Forgot password?** link.
- Confirm signup: create a new account (only sends if
  Authentication → Providers → Email → **Confirm email** is ON).

Check the logo renders and the button link works.

## What stays Supabase-branded (and how to change it)

The **sender address** is still `noreply@mail.app.supabase.io` on the
default mailer — the email *body* is fully yours now, but the From
line isn't. To send from e.g. `noreply@orderinn.com`:

- Supabase → Authentication → **SMTP Settings** → enable **Custom SMTP**
  and point it at an email provider (Resend, Brevo, Postmark, etc.).
- Requires a domain you control. Several providers have free tiers
  (Resend ~3,000/mo, Brevo ~300/day).

This is a separate task and needs a sending domain, so it's deferred
until OrderInn has one. The templates here don't depend on it — they
work the same on the default sender.
