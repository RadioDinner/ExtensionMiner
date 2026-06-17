# ExtensionMiner — Feature List (running backlog)

> A running list of features the user wants. **This is a capture-only backlog.**
> When the user says *"add this to the feature list"* (or anything like it), the
> item is appended here and **work does NOT start** until they explicitly ask for
> it. **Once a feature ships, REMOVE it from this list** (don't keep it as
> "done"). See CLAUDE.md §6 for the rule.

**Status legend:** 🆕 Proposed · 🔨 In progress · ❄️ On hold
(Shipped → deleted from this list.)

---

## 1. 🆕 Recency-weighted review scoring (decay old reviews)
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

## 2. 🆕 Richer extension detail page (problem clusters, "what it is", profitability)
When you open an extension from a list to read its reviews (`/reviews/<ext_id>`),
show more than the raw review list:

- **Summary of user challenges/problems**, *clustered*, so you can see when
  multiple people hit the **same** issue (the recurring complaint + how many
  distinct reviewers raised it).
- **Summary of what the extension is and does** (a plain "function overview").
- **More detailed profitability numbers** on the details page (the full
  monetization breakdown — pricing tiers, user estimate, revenue range,
  confidence, basis — not just the dashboard's compact column).

Implementation hints (from the user): the **ranking layer** builds the
problems/ratings summary and the function summary; the **dashboard** then
displays them. Likely reuses what's already there — `opportunities.details`
(complaint clusters + counts) and the `monetization` table — plus a NEW
"what it does" summary field added to the ranking output.

## 3. 🆕 "Deep dive research" pool — hand-pick extensions for a comprehensive Claude deep dive
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
