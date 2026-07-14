# Monarch ⇄ Amazon Transaction Matcher — Product Spec

> **Status:** Spec agreed via grill session (Session 9, 2026-07-14). Not yet built.
> Four decisions could not be collected interactively (the question stream kept
> dropping) and are **defaulted + flagged `OPEN`** below — override any of them
> and the spec updates, nothing downstream is blocked on them.
>
> **Working name:** `monarch-amazon-matcher` (placeholder — see OPEN-4).
> Lives in this repo for now (`monarch-amazon-matcher/`); can be extracted to
> its own repo before store submission.

---

## 1. The problem

Amazon charges arrive in Monarch Money as opaque bank-feed rows
(`AMZN Mktp US*1A2B3C`, `AMAZON.COM*Z99XY`) whose amounts don't map 1:1 to
orders: Amazon charges **per shipment**, combines orders, and issues refunds as
separate credits days or weeks later. Today the user opens two browser windows
(Amazon order history + Monarch) and manually matches orders, refunds, and
amounts one by one.

**The product:** a Chrome + Firefox browser extension that signs into the
user's own Amazon account (their existing browser session), reads their order
history, matches each Amazon charge/refund to the corresponding Monarch
transaction, and enriches Monarch automatically — with a review queue for
anything ambiguous.

---

## 1.5 ⚠️ STRATEGIC FINDING (from the research pass — decide before building)

**Monarch already ships an official, free Chrome extension that does the core
of this**: *"Monarch Money | Retail purchase sync"* (Chrome Web Store id
`imfcckkmcklambpijbgcebggegggkgla`, ~90,000 users, ~4.27★/67 reviews, v1.0.22
as of 2026-04-30). It syncs Amazon US (and, since Aug 2025, Target) orders,
matches by date/amount/merchant, auto-splits, AI-categorizes per item, writes
itemized notes, and tags transactions "Retail Sync". Monarch has announced
more retailers + Amazon Canada as planned.

**A straight "match Amazon to Monarch" product is therefore dead as a paid
standalone.** But the official tool's *stated exclusions and complaints* map
almost exactly onto this spec's requirements:

| Official extension gap | This spec |
|---|---|
| **No refunds/returns handling** | D3 makes refunds first-class |
| **~3-month history limit** (top complaint) | D7 backfills *everything* |
| No Whole Foods / Fresh / Kindle / digital | out of v1 here too (D3) — future wedge |
| No Amazon business accounts, no Amazon Canada | future wedge |
| Chrome-family only — **no Firefox** | D12 ships Firefox |
| Sync-reliability complaints (top recurring review theme) | reliability as a feature |
| Gift-card / split-tender mismatches | matcher handles via per-charge ledger |

**STRAT-0 (owner must decide):**
- **(a) Gap-filler / companion** *(research-recommended default)* — position as
  the tool for what the official extension can't do: full-history backfill,
  refunds/returns reconciliation, review-queue control, Firefox. Coexists with
  (or replaces) the official tool for power users.
- **(b) Full independent matcher anyway** — everything in this spec, competing
  head-on with free first-party. Justifiable mainly as personal tooling +
  learning; weak as a store product.
- **(c) Kill / just use the official extension** — it may already solve enough
  of the original pain (orders), though **not refunds and not old history**,
  which were the owner's explicitly stated pains.
- **(d) Multi-app pivot** — the only *proven paid* demand in this niche is in
  the YNAB ecosystem (Ace My Budget, Bridge Your Budget: hosted SaaS, ~$2–5/mo)
  precisely because YNAB has an official API and no first-party feature. A
  cross-app "Amazon itemizer" (YNAB + Lunch Money + Monarch) diversifies the
  Monarch-platform risk.

The spec below remains written for the agreed scope (D1–D12), which is
compatible with **(a)** and **(b)** — the build is nearly identical; only
positioning, naming, and store listing differ.

---

## 2. Decision record (from the grill session)

Every decision below was made explicitly by the product owner unless marked
`OPEN` (defaulted).

### D1. What a match writes to Monarch — ALL of:
- **Notes:** Amazon item name(s), order number, link to the order
  (e.g. `Amazon order #114-…: USB-C cable, dog food (2 items)`).
- **Merchant rename:** `AMZN Mktp US*1A2B3C` → readable, e.g.
  `Amazon — USB-C cable +1 more`.
- **Auto-categorization:** infer a Monarch category from the items.
- **Splits:** split multi-item charges into per-item Monarch splits with their
  own amounts and categories.

### D2. Autonomy — auto-apply + review queue
- Exact-amount, unambiguous matches **apply automatically**.
- Anything fuzzy (split shipments, partial refunds, two orders with the same
  amount, near-miss amounts) lands in a **review queue** with one-click
  confirm/reject.

### D3. Coverage — orders, split shipments, refunds
- Regular amazon.com orders, including one order → multiple card charges
  (per shipment) and multiple orders charged together.
- **Refunds & returns:** match refund credits back to the original
  order/return, including partial refunds.
- Explicitly **out of scope for v1:** Subscribe & Save/digital/Prime
  renewals, Whole Foods / Amazon Fresh. (Revisit post-v1.)

### D4. UI surface — inside Monarch's page
- The extension injects directly into the Monarch web app
  (`app.monarchmoney.com`): matched transactions get annotated/badged in
  place; the review queue appears as an overlay/panel there. No window
  switching. (A minimal toolbar popup shows sync status + "Sync now".)

### D5. Amazon data access — silent background fetch
- Uses the user's existing amazon.com login via host permissions; fetches
  order-history/detail/invoice pages in the background, politely rate-limited.
- If Amazon demands re-login or CAPTCHA, surface a prompt asking the user to
  open Amazon once, then resume.

### D6. Monarch write path — unofficial internal GraphQL API
- The extension reuses the user's Monarch web session and calls the same
  internal GraphQL API the Monarch app itself uses (the approach community
  tools use). This is the only realistic way to do splits and reliable edits.
- **Accepted risks (owner signed off):** breakage when Monarch changes the
  API; automation is technically outside Monarch's ToS.

### D7. Backfill — EVERYTHING
- First run walks the user's **entire Amazon order history** and matches
  whatever Monarch still has. Long first sync is accepted; it must be
  resumable/incremental (checkpointed) so an interrupted backfill continues
  rather than restarts.
- **Research refinement (R1):** deep backfill should primarily use Amazon's
  official Privacy Central **"Request My Data"** export (user requests it,
  drops the ZIP on the extension, we parse `Retail.OrderHistory`) — ToS-clean,
  complete, and avoids scraping years of pages. Live scraping covers the
  recent window and ongoing incremental sync. This also beats the official
  Monarch extension's ~3-month limit — a headline differentiator.

### D8. Split rules — only when categories differ
- A multi-item charge whose items all map to one category stays a single
  transaction with that category.
- A charge mixing categories (dog food + HDMI cable) is split so each part
  lands in the right category.
- (Combined with D2: only *unambiguous* splits auto-apply; the rest queue.)

### D9. Sync cadence — on opening Monarch + manual
- Every time the Monarch web app is opened, a background sync runs and
  annotates what it finds. A **"Sync now"** button exists in the injected UI
  and the toolbar popup. No scheduled background activity when Monarch isn't
  in use.

### D10. Already-edited transactions — queue for review with a diff
- Transactions the user has already manually renamed/categorized/annotated in
  Monarch are **never auto-modified**. They land in the review queue showing
  a diff (current values vs. proposed enrichment); the user chooses per
  transaction.

### D11. Multiple Amazon accounts — yes (owner: "Ideally we could have
multiple amazon accounts signed in")
- Household reality: charges from more than one Amazon account (spouse,
  household members) hit the cards Monarch sees.
- v1 ships **single-account**; v1.x adds multi-account: each connected
  account's orders are ingested and tagged by account, using Amazon's account
  switcher (the extension prompts to switch when it needs to sync a non-active
  account — see Research §R2 for what's technically possible silently).

### D12. Distribution — publish to BOTH stores
- Chrome Web Store + Firefox Add-ons (AMO), public listings. This makes it a
  **product**, not a personal tool: privacy policy, permission justifications,
  store assets, review-proof packaging are all in scope.
- Firefox note: permanent installs require Mozilla-signed builds anyway, so
  AMO submission is on the critical path regardless.

### OPEN decisions (defaulted — override any of these)

| # | Question | Default taken | Alternatives offered |
|---|----------|---------------|----------------------|
| OPEN-1 | Audience/monetization | **Free public tool at launch**; architecture must not preclude a paid tier later (feature flags around backfill depth, splits, multi-account — the natural premium levers). *Research (R2): no one has demonstrated paying for a local Monarch matcher; the only paid niche is hosted SaaS in the YNAB ecosystem — free is the realistic launch mode.* | Freemium from day one; paid-only; private until proven |
| OPEN-2 | Categorization engine | **Rules + optional AI:** built-in keyword/department rules work offline for everyone; user may paste an Anthropic API key to have Claude classify odd items into *their* custom Monarch categories; uncategorizable → review queue | AI-first (every user needs a key); rules-only |
| OPEN-3 | Data/privacy model | **Local-only:** all data (order cache, matches, settings) stays in browser extension storage. Network calls only to amazon.com, monarchmoney.com, and — if AI is enabled — the Anthropic API. This is the store privacy-policy story. | Local + opt-in encrypted sync; cloud-backed service |
| OPEN-4 | Name | **Placeholder `monarch-amazon-matcher`** until pre-submission. *Research (R4): must be a distinctive mark + "for" phrasing — e.g. "Butterfly Box for Monarch Money", "OrderSync for Monarch Money" — never leading with Monarch/Amazon, generic icon, "not affiliated" disclaimer.* | "Butterfly Box", "OrderSync", "Reconcile" (+ "for Monarch Money") |

---

## 3. How it works (user-visible behavior)

1. **Install & connect.** User installs the extension, opens Monarch → the
   extension detects the session. It asks for amazon.com access and confirms
   the Amazon login it can see. (Multi-account: connect more later.)
2. **First sync (backfill).** With Monarch open, the extension pulls the full
   Amazon order history (politely, checkpointed) and all Monarch transactions
   that look like Amazon (`AMZN*`, `Amazon*`, `AMZN Mktp`, Amazon-flagged
   merchants), then runs the matcher.
3. **In-place enrichment.** In Monarch's transaction list, matched rows get a
   badge (✓ matched / ● queued / ⚠ conflict). Auto-applied rows show their new
   name/notes/category/splits natively — because they were written through
   Monarch's own API, they also show correctly in Monarch's mobile apps.
4. **Review queue.** A panel (injected into Monarch) lists: fuzzy matches,
   category-mixing splits below the confidence bar, partial refunds, and
   already-edited transactions (with diffs, per D10). Each row: accept /
   edit / reject. Bulk-accept for high-confidence groups.
5. **Ongoing.** Each time Monarch is opened (or "Sync now" is clicked) the
   extension fetches recent orders + transactions and repeats. Every write is
   journaled locally with an **Undo** (restores the pre-write field values).

### Matching logic (v1)

**Primary Amazon data source (per R1):** the Transactions page
(`/cpe/yourpayments/transactions`) — per-charge rows (date, card last-4,
order IDs, amount, refunds included) joined to order-detail/item data by
order ID. Charges, not order totals, are what banks see, so this makes rule 1
the common case instead of the lucky case.

Candidate generation, in order of strength:
1. **Exact charge match:** Amazon per-shipment charge amount + card last-4 (when
   available) + date window (±4 days of ship/charge date) → single Monarch
   transaction of that amount. Auto-apply.
2. **Order-total match:** order total equals one Monarch transaction (single
   shipment orders). Auto-apply if unique in window.
3. **Combination match:** subset-sum over a small window for orders charged
   together or one order split across charges (bounded: ≤4 charges per group).
   Queue unless exact and unique.
4. **Refund match:** refund credit amount ↔ return/refund event on an order
   (full or partial). Full-amount unique → auto-apply; partial or ambiguous →
   queue, annotated with the original order's match.
5. **Leftovers:** Amazon-looking Monarch transactions with no order match, and
   orders with no transaction (other payment method, gift-card-only) are
   listed in the queue's "unmatched" tab rather than silently dropped.

Confidence scoring combines amount exactness, date proximity, uniqueness of
the candidate, and payment-method hints. Only score ≥ the auto threshold AND
unique candidates auto-apply; everything else queues (D2).

---

## 4. Architecture

```
monarch-amazon-matcher/
├── SPEC.md                  # this file
├── manifest.chrome.json     # MV3 (service worker)
├── manifest.firefox.json    # MV3 (event pages; gecko id for AMO signing)
├── src/
│   ├── background/          # sync orchestrator, alarms, fetch pipelines
│   │   ├── amazon/          # order-history fetcher + parsers (per page type)
│   │   ├── monarch/         # GraphQL client (reused session token), mutations
│   │   └── matcher/         # candidate generation, scoring, subset-sum
│   ├── content/
│   │   ├── monarch-overlay/ # injected badges, review-queue panel (app.monarchmoney.com)
│   │   └── token-bridge.js  # captures Monarch auth token for the background client
│   ├── categorize/          # rules engine + optional Anthropic classifier
│   ├── storage/             # IndexedDB schema: orders, charges, matches, journal, checkpoints
│   └── popup/               # status + Sync now + account list
├── shared/                  # types, money math (integer cents), date windows
└── test/                    # matcher unit tests on fixture data (pure, no network)
```

- **Cross-browser:** one WebExtensions codebase, MV3 on both; `webextension-polyfill`
  for promise APIs; per-browser manifests generated at build. Chrome service
  worker keeps long syncs alive via `chrome.alarms` + checkpointed work chunks
  (every unit of work is resumable, per D7).
- **Amazon module:** three ingestion paths — (1) **export parser** for the
  Privacy Central ZIP (deep backfill, D7); (2) **order/detail fetcher**:
  background `fetch` with host permissions (cookies ride along), AZAD's
  politeness envelope (≤6 concurrent, 1–4 s pacing with jitter, exponential
  backoff, hard page caps), IndexedDB response cache so re-syncs never
  re-fetch immutable order pages, incremental sync stops at cache overlap;
  (3) **transactions-page worker**: the page is JS-rendered, so it runs in an
  offscreen document / extension tab context (AZAD-style iframe worker)
  rather than raw fetch. Parsers are versioned, multi-strategy ("largest
  plausible result wins"), with fixture tests per page type; logout/CAPTCHA
  pages are detected and pause the run. Only specific Amazon domains in
  `host_permissions`; other locales via `optional_host_permissions`.
- **Monarch module:** content script on the Monarch app (cover both
  `app.monarchmoney.com` and `app.monarch.com`) reads the session token from
  localStorage (`persist:root` → `user.token`, plus `monarchDeviceUUID`);
  GraphQL calls go to `https://api.monarch.com/graphql` (endpoint
  configurable — it already migrated once, R3) preferably as same-origin
  fetches from the content script. Reads via `Web_GetTransactionsList`;
  writes via `Web_TransactionDrawerUpdateTransaction`,
  `Common_SplitTransactionMutation`, `Web_SetTransactionTags` (see R3 table).
  All mutations journaled for Undo.
- **Matcher:** pure functions over normalized `Charge`/`Refund`/`Txn` records —
  fully unit-testable offline with fixtures (this part is buildable and
  testable in the Claude-Code web env even though amazon.com is egress-blocked
  here).
- **Money:** integer cents everywhere; never float.

### Privacy (per OPEN-3 default)
Local-only. No telemetry, no external servers. Data leaves the browser only
toward amazon.com, monarchmoney.com, and (opt-in, user's own key) the
Anthropic API. Privacy policy for the stores states exactly this.

---

## 5. Research findings (verified 2026-07-14)

> Produced by a fan-out research pass (4 topics × independent web-research
> agents) with adversarial verification of key claims. Anything refuted during
> verification was corrected before landing here. Chrome Web Store, Reddit,
> and monarch.com direct fetches were 403-blocked in the research environment;
> those data points come from secondary trackers and are marked approximate.

### R1. Amazon order-history access (HIGH confidence overall)

- **No consumer API exists.** Amazon killed the official Order History Reports
  CSV on **2023-03-20**. The replacement, Privacy Central **"Request My Data"**
  (Your Orders category), returns a ZIP of CSV/JSON (incl.
  `Retail.OrderHistory`) within hours-to-days — ToS-clean, complete, but
  asynchronous and manual. **Design consequence: use it as the "backfill
  everything" (D7) path** — user requests the export, drops the ZIP on the
  extension, we parse it. Live scraping is reserved for incremental sync.
- **State of the art is `philipmulcahy/azad`** ("Amazon Order History
  Reporter", Apache-2.0, actively maintained — commits within days of
  2026-07-14, verified). It fetches, on the user's logged-in session: order
  list (`/gp/css/order-history`, `/your-orders/orders`), order details,
  invoice pages, legacy digital orders, and the **Transactions page**.
- **The Transactions page (`/cpe/yourpayments/transactions`) is the
  per-CHARGE ledger** — rows carry date, payment method/card last-4, order
  ID(s), amount, vendor, **including refunds**. Amazon's own help pages direct
  users there to match card statements. This solves the
  order-total ≠ card-charge problem *by construction* and is the primary
  financial surface for the matcher. It is also the **most hostile** surface:
  JS-rendered, button/scroll pagination, rate-limited (429s), and Amazon has
  already flattened its layout and obfuscated attribute names (AZAD needed a
  third parsing strategy in v1.16.19).
- **Anti-bot envelope (copy AZAD's):** ≤6 concurrent same-domain requests,
  ~1 s pacing + hard page caps on transactions, cache everything scraped,
  incremental sync stops at overlap with cache, scrape one year at a time.
  Amazon's typical response to over-fetching is **selective session logout**
  on some page types and 429s — the fetcher must detect logout/CAPTCHA pages
  and pause gracefully, never retry-hammer (refines D5).
- **Multi-account (D11):** Amazon "Switch Accounts" keeps multiple identities
  in the browser but only ONE active session; cookies are scoped to the active
  account and there is no documented way to fetch pages as an inactive
  account. v1.x multi-account = detect active account, tag data by account,
  prompt the user to switch (or use a second profile/container). Verify
  cookie behavior empirically before building the UX (this fact is inferred,
  MEDIUM confidence).
- **Refund caveat:** refunds to gift-card balance never hit the card; order
  pages give order-level (not item-level) refund amounts. Model gift-card
  refunds explicitly as "no card credit expected".

### R2. Prior art & competition (HIGH confidence; store metrics approximate)

- **Monarch's official "Retail purchase sync" extension** — see §1.5. Facts
  verified: ~90k users, 4.27★/67 reviews, v1.0.22 (2026-04-30); Target support
  shipped **Aug 2025**; exclusions confirmed from Monarch's own help pages:
  refunds, Kindle/digital, Whole Foods, Amazon Fresh, business accounts,
  non-US Amazon; ~3-month initial-history limit and sync-reliability failures
  are the recurring complaints.
- **Third-party Monarch tools** (all free/OSS, all on the unofficial GraphQL
  API): `alex-peck/monarch-amazon-sync` (Chrome ext, notes-only, 95★,
  unmaintained since Oct 2024 — its 24 open issues are a free pain-point
  list); `elsell/monarch-money-amazon-connector` (Python, notes-only, 32★);
  `jprouty/monarchmoney-amazon-tagger` (port of the 224★ Mint splitter);
  `eshaffer321/itemize` (Go CLI, AI-splits Amazon/Walmart/Costco, **actively
  developed through July 2026** — the closest living blueprint).
- **Adjacent ecosystems:** Copilot has first-party Amazon itemization
  (matches on amount ± 2-day window — a sane default for our matcher too).
  **YNAB is where paid demand is proven** (Ace My Budget, Bridge Your Budget —
  hosted SaaS subscriptions) because YNAB has an official API and no
  first-party feature. Lunch Money invites integrations via official API.
- **Pricing norm:** first-party = free; OSS = free; the only observed paid
  model is hosted "we run it for you" SaaS (~$2–5/mo, 14-day trials) where no
  first-party tool exists. **Nobody has demonstrated willingness to pay for a
  local Monarch matcher** (informs OPEN-1: free is the realistic launch mode).

### R3. Monarch internal GraphQL API (HIGH confidence — verified against library/extension source)

**Every write in D1 is proven feasible from an extension context.** The
canonical reference is `hammem/monarchmoney` (Python), with active successors
(`keithah/monarchmoney-enhanced`, `keithah/monarchmoney-ts`). Verified
operation names:

| Need | GraphQL operation |
|---|---|
| Read transactions (date range, merchant search, category/account/tag filters, `isSplit`, `hasNotes`, …) | `GetTransactionsList` / `Web_GetTransactionsList` (+ `GetTransactionDrawer` for detail) |
| Rename merchant / set category / notes / hidden / needsReview | `Web_TransactionDrawerUpdateTransaction` (input: `id`, `name`, `category`, `amount`, `date`, `hideFromReports`, `needsReview`, `goalId`, `notes`) |
| Read splits | `TransactionSplitQuery` |
| **Create splits** | `Common_SplitTransactionMutation` — `splitData` = array of `{merchantName, amount, categoryId, notes?}`; **amounts must sum exactly to the original transaction total**; empty array un-splits |
| Tags | `GetHouseholdTransactionTags` (list), `Common_CreateTransactionTag` (name+color), `Web_SetTransactionTags` (transactionId, tagIds[]) |
| Create/delete transactions | `Common_CreateTransactionMutation` / `Common_DeleteTransactionMutation` |

- **Auth from an extension:** the web app stores the token in localStorage —
  `JSON.parse(JSON.parse(localStorage.getItem('persist:root')).user).token` —
  and the device id under `monarchDeviceUUID`. Requests send
  `Authorization: Token <token>`, `device-uuid`, `Client-Platform: web`.
  This exact pattern ships today in `alex-peck/monarch-amazon-sync` and the
  Monarch-Money-Tweaks extension (Chrome + Firefox, v5.12) — direct proof the
  session-reuse approach works in production extensions.
- **⚠ The API host migrated `api.monarchmoney.com` → `api.monarch.com`
  (reported 2026-01-16)**, breaking hardcoded clients (525/auth errors).
  Design consequence: endpoint and operation strings live in one
  configurable module; never hardcode. (The web app also moved toward
  `app.monarch.com` — content scripts and host permissions must cover both
  `*.monarchmoney.com` and `*.monarch.com`.)
- **Prefer same-origin fetch from the content script** on the Monarch app
  page (cookies + CSRF attach automatically, sidesteps Cloudflare issues that
  plague headless clients), with the background worker as fallback.
- **Splits validation:** resolve `categoryId`/`tagIds` via `GetCategories` /
  `GetHouseholdTransactionTags` first; split amounts must sum exactly
  (integer-cents math, D-architecture) or the mutation is rejected.
- **ToS/enforcement:** Monarch's Terms prohibit crawling/scraping/programmatic
  access; **no enforcement precedent found** (community discussion unanswered,
  no known bans). No official public API as of mid-2026; a `public-api`
  status-page component exists and employees have signaled intent — keep the
  GraphQL client swappable for an eventual official API.
- **Implementation guidance:** mirror the live web app's payload shapes from
  DevTools rather than trusting the Python lib byte-for-byte; handle 401 by
  re-reading the token; keep writes user-initiated where possible to minimize
  ToS surface, and disclose the ToS caveat to end users (also a store-review
  plus, R4).

### R4. Store policy & MV3 constraints (HIGH confidence)

- **Chrome Web Store:** the single-purpose framing must be one sentence
  ("imports your own Amazon purchase details into your Monarch Money account
  and categorizes them") and every permission/data-flow must map to it.
  **Narrow host permissions** (specific Amazon domains + Monarch API host,
  never `<all_urls>`) *minimize* review time (most clear <24 h; flagged
  reviews ~1–2 weeks). Per-permission written justifications are required;
  vague ones are a top rejection cause. Financial data = sensitive under
  Limited Use; the optional Anthropic call must be disclosed as third-party
  sharing. **New CWS policy enforcement starts 2026-08-01:** ALL data
  collection must be prominently disclosed and post-install changes to data
  handling proactively re-disclosed — plan the consent UI for this from day
  one. MV3 remote-code ban is fine here (fetched JSON is data, not code).
  Precedent: AZAD has lived in CWS for years doing the Amazon half.
- **Firefox/AMO:** listed builds with bundlers require human-readable source +
  reproducible build instructions + lockfiles; obfuscation banned. Since
  **2025-11-03**, new extensions must declare data collection/transmission in
  `manifest.json` (`browser_specific_settings.gecko.data_collection_permissions`)
  using Firefox's consent UI. Firefox MV3 = event pages (not service
  workers); host permissions are user-revocable at any time → runtime
  `permissions.request` recovery flow is mandatory. Unlisted signing is
  near-instant — use it for the beta channel before listing.
- **MV3 service-worker lifetime (Chrome):** killed ~30 s idle / ~5 min hard
  cap. Long syncs must be chunked + checkpointed and resumed via
  `chrome.alarms`, or run in an offscreen document / visible extension tab
  (AZAD scrapes from a page context). Cross-origin `fetch()` from the worker
  WITH host permissions sends cookies and bypasses CORS — the intended
  mechanism. `declarativeNetRequestWithHostAccess` only if Monarch's endpoint
  needs Origin/Referer rewrites.
- **Naming/trademark (OPEN-4):** the enforced convention is a distinctive
  mark + "for" phrasing — e.g. **"OrderSync for Monarch Money"** — generic
  icon, no brand logos/colors, "not affiliated with Monarch or Amazon" in the
  listing. Leading with "Monarch" or "Amazon" invites a complaint-driven
  takedown — and Monarch, running a competing official extension, has motive
  and standing. (This kills the raw "Butterfly Box… Monarch"-led candidates'
  riskier variants; adjust naming shortlist accordingly.)

---

## 6. Milestones

- **M0 — Skeleton:** manifests, build (both browsers), token-bridge proves it
  can read the Monarch session; hello-world overlay in Monarch.
- **M1 — Read-only match preview:** Amazon fetcher + Monarch reads + matcher;
  overlay shows proposed matches; **no writes yet.** (Safe end-to-end proof.)
- **M2 — Writes + review queue:** notes/rename/category writes, journal +
  Undo, review queue UI, already-edited diff flow (D10).
- **M3 — Splits + refunds:** split mutations (D1/D8), refund matching (D3),
  full backfill hardening (D7 checkpoints).
- **M4 — Product polish:** categorizer rules pass + optional AI (OPEN-2),
  multi-account (D11), options page, onboarding.
- **M5 — Store submission:** privacy policy, permission justifications,
  assets, AMO source-code package, Chrome/AMO review (D12).

## 7. Top risks

0. **First-party competition (NEW, see §1.5):** Monarch's free official
   extension owns the core use case and Monarch has motive + standing to
   file store complaints against confusingly-named competitors and to break
   the unofficial API. Mitigations: gap-filler positioning (STRAT-0a),
   "for Monarch Money" naming, swappable GraphQL client, watch for the
   official public API.
1. **Monarch API drift** (unofficial): pin known-good operation shapes, fail
   soft to read-only overlay mode when mutations start erroring, ship updates
   fast. (Owner accepted, D6.)
2. **Amazon HTML drift / anti-bot:** parser versioned per page type with
   fixture tests; CAPTCHA → pause + user prompt (D5). Backfill "everything"
   (D7) magnifies exposure → strict politeness + resumability.
3. **Amount ≠ order total** (per-shipment charging): this is the core
   complexity the matcher exists for; the transactions/invoice data source
   choice (Research §R2) decides how hard this is.
4. **Store review friction** for an unofficial-API finance extension (D12):
   strongest mitigations are the local-only privacy story (OPEN-3) and
   precise, minimal host permissions.
5. **Writes to real financial data:** journal + Undo on every mutation;
   review queue defaults conservative; already-edited rows never clobbered
   (D10).
