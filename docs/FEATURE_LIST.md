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
