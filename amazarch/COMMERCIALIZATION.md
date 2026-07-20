# Amazarch — Commercialization Plan

> Written Session 11 (2026-07-20) in answer to: *"What work would need to be
> done so I could sell subscriptions to it, or let people purchase the plugin
> outright?"* Phase 1 = technical work to make it sellable; Phase 2 = go to
> market. Grounded in the v0.6.0 codebase and SPEC.md (D13/D15/D17, M3–M5, R2/R4).

---

## Where it stands today (v0.6.0)

**Built and working (for one user):** Monarch session detection (cookie+CSRF),
Amazon order scraping with configurable multi-year lookback, exact-amount
matcher (auto / review / unmatched / refund-flagged), notes + merchant-rename
writes with server-side verification and one-shot Undo, auto-match settings,
116 passing tests, Chrome + Firefox builds.

**Not built:** refund *matching* (refunds are only flagged — `matcher.ts`
routes money-in rows to a future refund matcher), splits, categorization,
multi-account, any backend, any accounts/billing/licensing, store listings,
privacy policy, onboarding for a stranger's machine.

The paid pitch per SPEC D17 is exactly the official free extension's gaps:
**refunds, full-history backfill, Firefox, reliability/control.** Two of four
(Firefox, reliability/undo/review) exist today. Refunds — the headline — does
not. Backfill exists but is unverified live (the Amazon time-filter param) and
the ToS-clean Privacy-Central ZIP path isn't built.

---

## Phase 1 — from "works for me" to "someone can pay and use it"

Five work areas, in recommended order. Lean-path estimate: **~50–80 focused
hours** plus 2–4 calendar weeks of beta.

### 1. Close the differentiation gap (~15–25h)
You cannot charge for notes+rename — free OSS tools and the official extension
already do that. The minimum sellable feature set is the stuff the free one
can't do:
- **Refund matching (M3 core):** match Monarch credit rows to Amazon
  refund/return events, full and partial, with the same verify+undo semantics.
  This is the single most load-bearing feature for the paid pitch.
- **Backfill hardening:** live-verify the year-filter deep sync; build the
  Privacy Central "Request My Data" ZIP parser as the bulk path (ToS-clean,
  complete, and the strongest answer to the official tool's #1 complaint).
- **Defer to v1.1:** splits + AI categorization. That's the official tool's
  *strength* — you don't out-compete it there at launch, and it's the largest
  remaining engineering lift. Ship refunds + backfill first, splits fast-follow.

### 2. Stranger-proofing (~10–20h)
Everything currently assumes your machine, your account, your layouts:
- **Onboarding:** first-run flow that walks a new user through "sign into
  Monarch → grant Amazon access → first sync", with explicit empty/error
  states (not signed in, CAPTCHA, zero Amazon transactions found).
- **Diagnostics:** an exportable, privacy-scrubbed diagnostic bundle
  (parser version, counts, error log — no financial data). Supporting paying
  users of a scraper without this is guesswork.
- **Kill switch / remote config:** a static JSON your extension polls
  (version floor, "writes disabled" flag, endpoint/operation names). When
  Monarch changes their GraphQL API, paying customers experience a broken
  product until you ship a store update — the kill switch turns that into
  "read-only mode, fix coming" instead of corrupted writes. Fetched JSON is
  data, not code — MV3-legal.
- **Parser resilience:** your fixtures come from one account. Beta will break
  them; make parser failures loud, versioned, and diagnosable rather than
  silent zeros.

### 3. Licensing & billing (~8–15h lean path)
Chrome Web Store native payments are dead; both stores require you to run your
own licensing. Two shapes:

- **Lean (recommended to start): merchant-of-record + license keys.**
  LemonSqueezy or Paddle hosts checkout, acts as merchant of record (they
  handle global sales tax/VAT — a big deal for a solo seller), and issues
  license keys with a validation API. The extension takes a key, validates
  against their API, caches the entitlement with an offline grace period
  (fail-open a few days — never brick on a network blip). Supports both
  subscriptions and one-time. **No custom backend needed at all.** This is a
  weekend of work, not a milestone. (ExtPay is even faster but rides your own
  Stripe account, leaving sales tax on you.)
- **Full (SPEC M4.5): Supabase Auth + Stripe + entitlement API.** Do this
  later, when/if you want cloud sync, the server-proxied Claude categorizer,
  or cross-device accounts.

**Deliberate scope cut from SPEC D15:** do **not** ship cloud sync of
financial data in v1. Licensing needs an entitlement check, not your users'
purchase history on your servers. Keeping all financial data local (IndexedDB)
eliminates the breach-risk custody problem (SPEC risk #6), shrinks the privacy
policy, lowers store-review friction under the CWS Limited Use rules, and
lowers the trust bar users must clear before paying for a finance extension.
Sync can return later as a feature if demanded.

**Subscription vs one-time:** subscription (~$3–4/mo or ~$30–35/yr, 14-day
trial). This product sits on two hostile, unversioned surfaces — Amazon's HTML
and Monarch's unofficial GraphQL — and will need perpetual maintenance; a
one-time price mismatches a perpetual obligation. The YNAB-ecosystem
precedent (Ace My Budget, Bridge Your Budget, ~$2–5/mo) is the proven model.
A *limited* lifetime tier at launch (e.g. first 100 at $79) funds the push and
creates urgency without capping the model. Don't over-engineer anti-piracy:
AMO requires readable source anyway; the durable gate is server-side value
(future AI categorizer proxy) and honest pricing.

### 4. Store packaging (M5) (~8–12h + review latency)
- **Extract `amazarch/` to its own repo** (AMO wants reviewable source +
  lockfile + build instructions; a repo containing the miner confuses that).
- **Chrome Web Store:** $5 dev account; one-sentence single-purpose
  description; per-permission written justifications; privacy policy URL;
  Privacy Practices tab. **The new CWS data-disclosure enforcement starts
  2026-08-01 — twelve days from now** — so build the prominent
  consent/disclosure UI into onboarding from day one; you'll be reviewed
  under the new regime.
- **Firefox/AMO:** `data_collection_permissions` manifest (draft exists —
  re-validate categories), signed builds. Use **unlisted signing for the beta
  channel** (near-instant) before the public listing.
- **Site + policies:** a landing page (Vercel — infra you already have),
  privacy policy, terms, support email, refund policy.
- **Naming:** keep "Amazarch" with the D16 mitigations ("for Monarch Money"
  subtitle, generic icon, not-affiliated disclaimer everywhere), fallback name
  in the drawer.
- **The ToS elephant, stated honestly:** writes go through Monarch's
  unofficial API against their ToS. No enforcement precedent exists, but for a
  *paid* product a Monarch-side break means refund requests, not just a broken
  hobby tool. Mitigations you already planned (fail-soft read-only mode,
  swappable client, kill switch) become table stakes. Disclose "community
  tool, not affiliated, uses unofficial APIs that can break" in the listing —
  it's also store-review armor.

### 5. Private beta (2–4 calendar weeks, low hours)
Non-negotiable before charging: 10–30 users from the target community (see
Phase 2 — the complaint threads are the recruiting pool), AMO-unlisted +
"load unpacked" Chrome. You are testing: parser breakage on other people's
Amazon layouts, match accuracy on other people's finances, onboarding
comprehension, and Amazon anti-bot behavior at stranger scale. Every beta bug
is a support ticket you didn't have to refund.

---

## Phase 2 — go to market

### Positioning
> **The Amazon sync for Monarch that handles refunds, your full order
> history, and Firefox — with a review queue and undo for every write.**

Never "better than Monarch's extension" as the headline — "picks up where the
official sync stops." Comparison honesty is the trust currency of the finance
community, and the not-affiliated line doubles as trademark armor.

### Price
$3–4/mo or $30–35/yr (annual as the default plan), 14-day free trial, limited
launch lifetime tier. Anchor to the YNAB precedent, not to what it "should" be
worth.

### Channels, in order of expected yield
1. **r/MonarchMoney** — the beachhead. The official extension's complaint
   threads ("only 3 months of history", "refunds never match") are literally a
   list of people with the exact pain, pre-articulated. Recruit beta there
   with a founder story ("I built this because my refunds never matched"),
   launch there with the beta users as social proof. Engage as a person, not
   a brand — this community detects astroturf instantly.
2. **The OSS graveyard:** `alex-peck/monarch-amazon-sync` (unmaintained, 24
   open issues = a lead list), `elsell/monarch-money-amazon-connector`, the
   Mint-tagger diaspora. A respectful "maintained alternative that also does
   refunds" comment in those issues reaches exactly-qualified users.
3. **Comparison-page SEO:** "Amazarch vs Monarch Retail Sync" honest feature
   table, plus pages targeting "monarch amazon sync refunds", "monarch amazon
   full history", "monarch retail sync alternative". Low volume,
   perfectly-qualified intent, compounds forever.
4. **Monarch-adjacent creators:** Monarch runs an affiliate program, so a
   whole tier of YouTubers/bloggers covers it constantly. Offer them free
   codes and/or your own affiliate cut.
5. **Store SEO:** the listings themselves ("for Monarch Money" phrasing) will
   be a steady organic channel.
6. **Product Hunt / HN:** modest expectations — this is a niche-of-a-niche;
   fine as a launch-week amplifier, not a strategy.

### Launch sequence
Beta (invite from complaint threads) → public launch post on r/MonarchMoney
with beta users vouching → comparison page live the same day → creator
outreach in week 2–3 → iterate on the #1 objection (it will probably be trust:
"why should a browser extension touch my finances?" — answer with local-only
data, readable source, undo-everything, and a public security page).

### Honest ceiling, and the hedge
Official extension ≈ 90k users, free. Realistic paid conversion for a
power-user add-on: hundreds to low thousands of subscribers — **$15–60k/yr at
maturity; a strong side business, not a company.** Structural risks: Monarch
ships refund support (they Sherlocked the core once already), Monarch breaks
the unofficial API, or Monarch ships the public API they've signaled — the
last one is actually *good* for you if the GraphQL client stays swappable:
"best third-party app on the official API" is the durable position.

The hedge is already in SPEC D17(d): the **YNAB market is where paid demand
is proven** (official API, no first-party feature, existing $2–5/mo SaaS
businesses). Keep the Monarch write layer behind an interface; if Monarch
kills the niche, the Amazon-ingestion + matcher core re-targets to YNAB as a
module swap, not a rewrite. Multi-app is also the answer if the Monarch-only
ceiling proves too low.

### Ops basics for actually selling
Merchant of record (LemonSqueezy/Paddle) handles sales tax; you still want a
sole proprietorship or LLC decision, a support inbox with a stated SLA
("solo developer, replies within 2 business days" is fine if stated), a
public changelog (reliability is the brand — show the maintenance), and a
simple refund policy (14-day no-questions — trials make refund requests rare).

---

## Decision points for the owner

1. **Subscription vs one-time** — recommendation: subscription + limited
   lifetime launch tier. (One-time only defensible if you want zero ongoing
   obligation, which this architecture can't honestly promise.)
2. **Entitlement-only backend vs full cloud sync (amends D15)** —
   recommendation: entitlement-only for v1; financial data stays local.
3. **Splits/categorization at launch vs fast-follow** — recommendation:
   fast-follow (v1.1); refunds + backfill are the sellable core.
4. **Whether to contact Monarch pre-launch** — recommendation: no; launch
   quietly as a community tool, keep the client swappable, court them only
   once you have users they'd rather not break.
