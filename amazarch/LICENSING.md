# Amazarch — Licensing & Kill-Switch Wiring

> How to turn on paid licensing and the remote kill-switch. Shipped in v0.9.0
> as **provider-agnostic scaffolding**: the code is in place and enforced, but
> stays fully open until you fill in `src/shared/config.ts`. See
> `COMMERCIALIZATION.md` for the business plan behind this.

---

## What's gated vs. free

- **Free, always:** reading Monarch transactions, fetching Amazon orders,
  matching (charges + refunds), the review queue, multi-account, the panel.
  Users see **every proposed match** before paying — that's the funnel.
- **Gated (paid):** *applying* a match to Monarch — the note write, the merchant
  rename, and refund applies (manual buttons **and** auto-match).

The gate is one pure function, `evaluateWriteGate` (`src/shared/write-gate.ts`),
composed from two inputs: the **entitlement** (trial/subscription/lifetime) and
the **remote config** (kill-switch). It's consulted both when the panel renders
(to show the paywall and hide the apply buttons) and again at click time (a
safety net), so it can't be bypassed.

---

## Turn on licensing (`src/shared/config.ts`)

Licensing enforces **only** once `validateUrl` is non-empty. Until then
`isLicensingConfigured()` is false and writes stay open (your own dev use is
unaffected). To go live, set:

```ts
export const LICENSE_CONFIG = {
  validateUrl: "https://<your-endpoint>/validate", // POST {key} -> canonical JSON
  buyUrl:      "https://<your-store>/checkout",     // hosted checkout / pricing
  manageUrl:   "https://<your-store>/billing",      // manage subscription (optional)
  trialDays:   14,
  graceDays:   5,
};
```

### The canonical validate response

`validateUrl` receives `POST {"key": "<license key>"}` and must return JSON in
this shape (a few aliases are tolerated — see `parseLicenseResponse`):

```jsonc
{
  "valid": true,                 // or "activated": true, or "status": "active"
  "plan": "monthly",             // "monthly" | "yearly" | "lifetime" (optional)
  "expiresAt": 1767225600,       // epoch seconds or ms, or ISO string, or null for lifetime
  "error": null                  // string when valid:false (shown to the user)
}
```

### Recommended: a thin serverless proxy (merchant-of-record path)

For **LemonSqueezy** or **Paddle** (the recommended MoR providers — they handle
global sales tax/VAT), point `validateUrl` at a tiny serverless function
(Vercel/Cloudflare) that:

1. Receives `{key}` from the extension.
2. Calls the provider's license-validate API **with your provider API key**
   (kept server-side — never ship it in the extension).
3. Maps the provider's response to the canonical shape above.

LemonSqueezy's `POST /v1/licenses/validate` returns `{valid, license_key:{status,
expires_at}, meta:{...}}`; map `license_key.status === "active"` → `valid`,
`license_key.expires_at` → `expiresAt`, and infer `plan` from the product/variant.
Paddle is analogous via its entitlements/subscriptions API.

### Alternative: ExtPay (fastest, but you own the tax)

ExtPay rides **your own Stripe** account, so **sales tax/VAT is on you** (no
merchant of record). It has its own SDK rather than a license-key REST call; if
you choose it, replace `validateKey` in `src/shared/licensing.ts` with ExtPay's
`getUser()` check and set `active/plan/expiresAt` from that. The gate, trial,
grace, and UI all stay the same.

---

## The remote kill-switch (`REMOTE_CONFIG_URL`)

Amazarch writes through Monarch's **unofficial** GraphQL API. When Monarch
changes it, you need to stop writes **immediately** — before a store update can
ship — or paying customers get failed/garbled writes. Point `REMOTE_CONFIG_URL`
at a **static JSON** you can edit (GitHub raw, a gist, an S3/Cloudflare object):

```jsonc
{
  "writesEnabled": true,          // set false → read-only "safe mode" for everyone
  "minVersion": "0.9.0",          // clients below this are told to update (writes off)
  "message": "Applying is paused for ~1h while we ship a fix for a Monarch change."
}
```

- **Fail-safe:** an unreachable or malformed config **never** blocks writes.
  Only an explicitly-fetched `writesEnabled: false` pauses them. So a config-host
  outage can't brick the product — only a deliberate flip can pause it.
- Fetched at most once per `REMOTE_CONFIG_TTL_MS` (6h), cached in `storage.local`.
- Fetched JSON is **data, not code** — MV3-legal.

This is the difference between "the product is broken and I'm getting refund
requests" and "read-only for an hour, matching still works, fix incoming."

---

## Trial, grace, and anti-abuse (already implemented)

- **Trial** auto-starts once, on first Monarch connect **after licensing is
  configured** (`ensureTrialStarted` no-ops while `validateUrl` is empty, so a
  pre-launch/self-hosted user doesn't silently burn their trial and then get
  zero days the moment you enable enforcement). `trialEndsAt` is immutable once
  set — reinstalling doesn't reset it *within* the same browser profile
  (storage.local persists); a determined user can clear storage, an accepted,
  low-value abuse for a $3/mo tool.
- **Background re-validation:** a twice-daily `browser.alarms` job (and a
  startup check) re-validates the stored key so `expiresAt`/`lastValidatedAt`
  stay fresh — this is what lets the grace window bridge a provider-side renewal
  without locking out a paying subscriber.
- **Offline grace:** a lapsed-but-recently-validated subscription keeps working
  for `graceDays` (default 5) so a provider outage or a renewal we couldn't
  re-verify yet never locks out a paying user.
- **Fail-open validation:** a network error during `validateKey` never wipes an
  existing entitlement — it only records `lastError`.

---

## Pre-launch checklist

- [ ] Pick a provider; create the product + a subscription price + a limited
      lifetime price (per `COMMERCIALIZATION.md`).
- [ ] Deploy the validate proxy (or wire ExtPay); set `validateUrl`/`buyUrl`.
- [ ] Publish the remote-config JSON; set `REMOTE_CONFIG_URL`. Test flipping
      `writesEnabled:false` → panel shows "paused", apply buttons vanish.
- [ ] Verify the funnel: with the trial expired, matches still render but
      applying shows the paywall; a valid key unlocks it.
- [ ] Privacy policy note: the only thing that leaves the machine for licensing
      is the license key sent to `validateUrl` (no financial data).
