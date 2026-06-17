# ExtensionMiner — Feature List (running backlog)

> A running list of features the user wants. **This is a capture-only backlog.**
> When the user says *"add this to the feature list"* (or anything like it), the
> item is appended here and **work does NOT start** until they explicitly ask for
> it. **Once a feature ships, REMOVE it from this list** (don't keep it as
> "done"). See CLAUDE.md §6 for the rule.

**Status legend:** 🆕 Proposed · 🔨 In progress · ❄️ On hold
(Shipped → deleted from this list.)

---

## 1. 🆕 "Competitors" card — Obsidian-style graph on the detail page
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
