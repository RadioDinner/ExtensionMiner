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
| OPEN-1 | Audience/monetization | **Free public tool at launch**; architecture must not preclude a paid tier later (feature flags around backfill depth, splits, multi-account — the natural premium levers) | Freemium from day one; paid-only; private until proven |
| OPEN-2 | Categorization engine | **Rules + optional AI:** built-in keyword/department rules work offline for everyone; user may paste an Anthropic API key to have Claude classify odd items into *their* custom Monarch categories; uncategorizable → review queue | AI-first (every user needs a key); rules-only |
| OPEN-3 | Data/privacy model | **Local-only:** all data (order cache, matches, settings) stays in browser extension storage. Network calls only to amazon.com, monarchmoney.com, and — if AI is enabled — the Anthropic API. This is the store privacy-policy story. | Local + opt-in encrypted sync; cloud-backed service |
| OPEN-4 | Name | **Placeholder `monarch-amazon-matcher`** until pre-submission | "Butterfly Box" (Monarch butterfly + Amazon boxes), "Order Matcher for Monarch", "Reconcile" |

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
- **Amazon module:** background `fetch` with host permissions (cookies ride
  along), 1 request every 2–4 s with jitter, exponential backoff, response
  cache in IndexedDB so re-syncs never re-fetch old immutable order pages.
- **Monarch module:** content script on `app.monarchmoney.com` captures the
  session token the web app already holds; background GraphQL client performs
  reads (transaction queries) and writes (update merchant/notes/category,
  tags, splits). All mutations journaled for Undo.
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

> Produced by a fan-out research pass with adversarial verification of key
> claims. Confidence noted per claim; anything REFUTED during verification was
> corrected before landing here.

_(pending — filled in below by the research workflow)_

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
