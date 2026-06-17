# ExtensionMiner — Feature List (running backlog)

> A running list of features the user wants. **This is a capture-only backlog.**
> When the user says *"add this to the feature list"* (or anything like it), the
> item is appended here and **work does NOT start** until they explicitly ask for
> it. **Once a feature ships, REMOVE it from this list** (don't keep it as
> "done"). See CLAUDE.md §6 for the rule.

**Status legend:** 🆕 Proposed · 🔨 In progress · ❄️ On hold
(Shipped → deleted from this list.)

---

## 1. 🆕 Sortable + filterable "Opportunity zone" card
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

## 2. 🆕 Sort displayed reviews by date or rating (everywhere reviews show)
**Anywhere a list of reviews is displayed in the dashboard**, let the user sort
the reviews by **date** or by **rating (stars)** — and toggle the direction
(newest/oldest, highest/lowest).

- Applies to **every** place reviews are rendered, not just one — currently the
  per-extension **saved-reviews list** on `/reviews/<ext_id>` and the
  **community-upvoted reviews** list on the home dashboard. If more review lists
  are added later, they should get the same control.

Implementation hints: client-side sort over the rows already fetched (no new
query), mirroring the `OpportunitiesCard.js` sort dropdown. Best done as a small
reusable sortable-review-list component (a client component) so each review list
reuses one control instead of duplicating it. Sort keys: `reviewed_at` (date)
and `stars` (rating), each asc/desc. Reviews already carry `reviewed_at` +
`stars`.

## 3. 🆕 "Competitors" card — Obsidian-style graph on the detail page
On the **extension detail page** (`/reviews/<ext_id>`), add a **Competitors**
card that shows an **Obsidian-like graph**: the current extension as a central
node with its **competitors as linked nodes** around it.

- **Force-directed / node-link graph** (like Obsidian's): central extension in
  the middle, an edge to each competitor.
- **Click a competitor node** to open that competitor's extension/listing page
  (link out in a new tab).
- Likely show a little context on hover/click (pricing, strengths/weaknesses)
  reusing what the deep dive already captures.

Competitor data comes from **the Claude system** — and largely **already
exists**: the deep-dive pool (`analysis/deepdive.py` → `DeepDiveReport.competitors`,
stored in `deep_dives.competitors` as `{name, url, pricing, strengths,
weaknesses}`) is exactly this. So this is mostly a **visualization** of existing
data. Possible enhancement: have the deep dive capture each competitor's Chrome
Web Store **listing URL / ext_id** explicitly so the node links straight to the
store page (today `url` may be a homepage). The card should degrade gracefully
when an extension hasn't been deep-dived yet (no competitor data → hide or show
a "run a deep dive" hint).

Implementation hints: the dashboard has no graph lib for this yet (`charts.js`
is a hand-rolled scatter, not node-link). Either hand-roll a small SVG
force-layout client component or add a lightweight graph lib; keep deps minimal.
The detail page already fetches the `deep_dives` row (`d.deepDive.competitors`),
so the data is in hand once a deep dive has run.
