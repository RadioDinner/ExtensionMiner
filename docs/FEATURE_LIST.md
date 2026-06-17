# ExtensionMiner — Feature List (running backlog)

> A running list of features the user wants. **This is a capture-only backlog.**
> When the user says *"add this to the feature list"* (or anything like it), the
> item is appended here and **work does NOT start** until they explicitly ask for
> it. **Once a feature ships, REMOVE it from this list** (don't keep it as
> "done"). See CLAUDE.md §6 for the rule.

**Status legend:** 🆕 Proposed · 🔨 In progress · ❄️ On hold
(Shipped → deleted from this list.)

---

## 1. 🆕 Monetization / pricing intel per extension
Surface, on the dashboard, whether an extension **makes money** and how it's
monetized: **paid / free / premium (freemium)**, plus an **estimated income**
over a sensible timeframe (daily / weekly / monthly / annual).

- Likely a **ranking-layer addition**: it needs an agent to research each
  extension for pricing plans, user-base size, etc., then estimate revenue.
- New stored fields (pricing model, price points, estimated income) + dashboard
  display.

## 2. 🆕 Sort & filter the "Scored opportunities" card
Make the **Scored opportunities** card sortable/filterable:

- Load highest-scored opportunities **by complaint type** (e.g. `bug`,
  `missing_feature`, …).
- **Filter paid vs. unpaid** extensions (depends on feature #1's pricing data).

## 3. 🆕 Recency-weighted review scoring (decay old reviews)
Keep collecting older reviews, but **down-weight old ones** in the ranking
algorithm, since very old reviews likely describe old releases. Apply a decay to
a review's contribution based on age (tune the exact curve):

- ≤ 3 months → highest weight
- ≤ 6 months → slightly lower
- ≤ 12 months → a bit lower than 6 months
- > 2 years → lower
- > 3 years → much lower
- (…continue the gradient as makes sense)

This affects scoring/ranking only — we still **store** all reviews regardless of
age.
