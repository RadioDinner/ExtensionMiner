# ExtensionMiner — Feature List (running backlog)

> A running list of features the user wants. **This is a capture-only backlog.**
> When the user says *"add this to the feature list"* (or anything like it), the
> item is appended here and **work does NOT start** until they explicitly ask for
> it. **Once a feature ships, REMOVE it from this list** (don't keep it as
> "done"). See CLAUDE.md §6 for the rule.

**Status legend:** 🆕 Proposed · 🔨 In progress · ❄️ On hold
(Shipped → deleted from this list.)

---

### 1. 🆕 Clickable points on the "Rating vs installs" scatter card
On the dashboard's **Rating vs installs** card, make the plotted circles
interactive: **clicking a circle loads/opens the extension that data point
represents.** If a single circle stands for a **group** of extensions (multiple
overlapping at the same rating/install spot), clicking should surface that whole
group (e.g. open a list/picker of the extensions behind that point) so the user
can drill into any of them.
- _Hints (user's words):_ "click the circles and have it load into the
  extension that the data circle represents, or the group of extensions that are
  represented in the data."
- _Impl notes (capture-only, for when it's built):_ the scatter lives in the
  dashboard home; each point should carry its `ext_id` (or the list of ext_ids
  when points are bucketed/clustered). A single-extension point → link straight
  to `/reviews/<ext_id>`; a multi-extension point → a small popover/list of the
  extensions at that point, each linking to its detail page.

### 2. 🆕 Opportunity zone: show ALL extensions in the zone + a limit filter
The **Opportunity zone** card currently caps at ~25 extensions. Let it **display
every extension that falls in the zone**, and add a **filter/limit control** so
the user can cap it to a chosen number (e.g. 25) when they want a shorter list.
- _Hints (user's words):_ "I want the opportunity zone to be more than 25
  extensions … display all the ones in the zone and then a filter to limit it to
  a certain amount, like 25."
- _Impl notes (capture-only, for when it's built):_ the home query currently
  limits the zone set (server-side) and `OpportunityZoneCard.js` renders/sorts/
  filters it client-side. Need to (a) raise/remove the server-side cap that
  feeds the zone, and (b) add a "Show N" limit selector (e.g. 25 / 50 / 100 /
  All) to the existing filter row so the default stays manageable but the user
  can expand to the full zone.
