# ExtensionMiner — Feature List (running backlog)

> A running list of features the user wants. **This is a capture-only backlog.**
> When the user says *"add this to the feature list"* (or anything like it), the
> item is appended here and **work does NOT start** until they explicitly ask for
> it. **Once a feature ships, REMOVE it from this list** (don't keep it as
> "done"). See CLAUDE.md §6 for the rule.

**Status legend:** 🆕 Proposed · 🔨 In progress · ❄️ On hold
(Shipped → deleted from this list.)

---

### 1. 🆕 Publisher column on the Opportunity Zone
Add a **"Publisher"** (developer) column to the Opportunity Zone section of the
dashboard so each zone row shows who makes the extension at a glance. The
`developer` field is already on the `extensions` table; surface it in the zone
table (and consider it for the other extension lists too).

### 2. 🆕 Scraper "prefer the Opportunity Zone" mode
Give the scraper the ability (a settable mode) to **prioritise the 25 extensions
currently in the Opportunity Zone**: before doing its normal crawl, it should
look at the current zone list and go fetch **every single review** for each of
those 25 extensions, exhaustively, then move on to its usual behaviour. Useful
for deep-loading review data on the exact targets we care about most.
