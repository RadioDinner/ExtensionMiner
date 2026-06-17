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
