# ExtensionMiner — Feature List (running backlog)

> A running list of features the user wants. **This is a capture-only backlog.**
> When the user says *"add this to the feature list"* (or anything like it), the
> item is appended here and **work does NOT start** until they explicitly ask for
> it. **Once a feature ships, REMOVE it from this list** (don't keep it as
> "done"). See CLAUDE.md §6 for the rule.

**Status legend:** 🆕 Proposed · 🔨 In progress · ❄️ On hold
(Shipped → deleted from this list.)

---

## 1. 🆕 Decline / complaint-trend detection — surface extensions getting WEAKER
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

## 2. 🆕 Sortable + filterable "Opportunity zone" card
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
