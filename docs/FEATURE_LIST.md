# ExtensionMiner — Feature List (running backlog)

> A running list of features the user wants. **This is a capture-only backlog.**
> When the user says *"add this to the feature list"* (or anything like it), the
> item is appended here and **work does NOT start** until they explicitly ask for
> it. **Once a feature ships, REMOVE it from this list** (don't keep it as
> "done"). See CLAUDE.md §6 for the rule.

**Status legend:** 🆕 Proposed · 🔨 In progress · ❄️ On hold
(Shipped → deleted from this list.)

---

## 1. 🆕 "Deep dive research" pool — hand-pick extensions for a comprehensive Claude deep dive
Let the user curate a small pool of extensions to research deeply, instead of
running expensive deep research on every extension (which burns tokens).

- **On the extension detail page**, add a button to **add that extension to a
  "Deep dive research" pool/list**. (Toggle to add/remove; the page shows
  whether the extension is already queued.)
- When the **Claude ranking layer** runs, build a **tool that iterates over that
  pool** and does a **comprehensive deep dive per extension** — e.g. thorough
  analysis of the reviews, the **competitors** that exist, and related signals —
  rather than doing all of that for *every* extension.

Rationale (from the user): the full deep dive (reviews + competitor research,
etc.) is token-expensive, so it should only run on a **hand-picked pool**, not
the whole catalog. The lightweight ranking/monetization passes still run across
everything; this deep dive is opt-in per extension.

Implementation hints: needs a way to flag/queue an extension (likely a new
column/table, e.g. a `deep_dive` flag on `extensions` or a small
`deep_dive_queue` table the dashboard writes to and the ranker reads). The
dashboard button writes the flag; a new analysis task (sibling to the existing
ranking/monetization passes) processes only flagged extensions and likely uses
Claude with web search/fetch for competitor research, writing results to a new
table the detail page can display.

## 2. 🆕 Decline / complaint-trend detection — surface extensions getting WEAKER
Have the ranking algorithm flag extensions that are **declining in quality** or
showing an **uptick of complaints in recent reviews**, so the user can **target
the weak ones and pick them off**.

- Detect a **downward quality trajectory** — e.g. recent reviews trending lower
  than the extension's historical baseline (rising share of 1–2★ over time, or a
  falling rolling average).
- Detect a **recent surge in complaints** — a spike in negative/complaint-type
  reviews in the latest window vs. the prior period (not just absolute volume).
- Surface these as a signal in the dashboard so declining/weakening extensions
  rank as **prime competitive targets**.

Rationale (from the user): a product that's getting *worse* over time — losing
the room, accumulating fresh complaints — is an especially good one to build a
competitor against and overtake.

Implementation hints: reviews already store **per-review timestamp + stars**, so
trend math (recent window vs. baseline, slope of rolling rating) can be computed
without new scraping; `rating_snapshots` (aggregate rating over time) can back
the store-level trajectory. Likely a new score/signal the ranker writes (e.g. a
`trend`/`decline_score` field on `opportunities`) that the dashboard sorts on.

## 3. 🆕 Sortable + filterable "Opportunity zone" card
Make the dashboard's **★ Opportunity zone** card interactive, like the "Scored
opportunities" card already is:

- **Sort by any column** — Extension, Category, Rating, Ratings (store count),
  Saved (reviews we've collected), Installs, Pricing, Est. /mo (estimated
  monthly revenue). Currently it's fixed to installs (high→low).
- **Toggle sort direction** per column — high→low or low→high (e.g. click the
  column header to sort, click again to flip).
- **Filter options** for the data shown — e.g. min installs, rating band within
  the zone, pricing model (paid / free·ads / unknown), has saved reviews,
  category. (Pick a sensible set.)

Implementation hints: mirror the existing client-side pattern in
`dashboard/app/OpportunitiesCard.js` (sort/filter happen in the browser over the
rows the server already fetched — no new query). The zone table is rendered by
the shared `ExtTable` in `dashboard/app/page.js`, which is **also** used for the
Lowest/Highest tables, so either add an opt-in sortable/filterable client
variant or split the zone out into its own client component so the other tables
stay untouched. Monetization columns (Pricing / Est. /mo) come from the
`monetization` map already passed in.
