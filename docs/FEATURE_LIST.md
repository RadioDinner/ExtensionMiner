# ExtensionMiner — Feature List (running backlog)

> A running list of features the user wants. **This is a capture-only backlog.**
> When the user says *"add this to the feature list"* (or anything like it), the
> item is appended here and **work does NOT start** until they explicitly ask for
> it. **Once a feature ships, REMOVE it from this list** (don't keep it as
> "done"). See CLAUDE.md §6 for the rule.

**Status legend:** 🆕 Proposed · 🔨 In progress · ❄️ On hold
(Shipped → deleted from this list.)

---

### 1. 🆕 Curate the opportunity zone: dismiss with a reason + auto-backfill to 25
_(Supersedes the earlier "show more than 25" idea — the user pivoted: instead of
a longer list, keep a curated **top 25** and let the user prune it.)_

Keep the **Opportunity zone** at a working list of **25**, but let the user
**remove** an extension that isn't a realistic target and have the zone
**backfill** with the next-best candidate so the list stays full at 25.
- **Per-row "Remove from zone" control** on every opportunity-zone row. Clicking
  it asks for a **reason** from a small preset list:
  **"Too large"**, **"Too complex"**, **"Uninterested"**, **"Publisher owned"**
  (e.g. Chrome Remote Desktop — 35M installs, published by Google itself; not a
  realistic target right now).
- **Auto-backfill:** when one is removed, pull in the next-highest-ranked
  extension not already in (or dismissed from) the zone, so the displayed list
  stays at 25.
- **Restore / "bring back to the pool":** a way to view dismissed extensions
  (with their reason) and **un-dismiss** them, returning them to consideration.
- _Hints (user's words):_ "a button on each row of the extensions in the
  opportunity zone where I can click 'Remove from zone' and add a cause … options
  for removal reason 'Too large','Too complex','Uninterested' and 'Publisher
  owned'. Then … the option to also bring them back to the pool, but whenever one
  is eliminated from the 25, I want more added to keep a list of 25."
- _Impl notes (capture-only, for when it's built):_
  - New persistence: a `zone_exclusions` table (ext_id/extension_id + reason +
    dismissed_at), service-role only like the rest. **Next migration = 990**
    (991 is now used by `app_settings`).
  - Writes go through Next.js **server actions** (service-role, server-side
    only) — same pattern as the deep-dive queue (`app/actions.js`).
  - The home zone query (`getDashboardData`) excludes dismissed ext_ids and
    fetches **>25** candidates so it can backfill up to 25 after exclusions.
  - `OpportunityZoneCard.js` gets the per-row Remove control + a reason picker,
    plus a "Dismissed" view (list with reason + Restore). Keep existing
    sort/filter behavior.

### 2. 🆕 Deep-dive status column in the extension list (4 icons)
In the **list of extensions**, add a **"Deep dive" status column** with **4
distinct icons**, one per state:
1. **Queued** — in the deep-dive pool, not yet researched.
2. **Done** — deep dive completed (today's 🔬).
3. **Errored** — the deep dive failed on its last run.
4. **Not queued / not in pool** — never added to the pool.
- _Hints (user's words):_ "a deep dive complete column. I want 3 unique icons.
  Queued, Done, and not queued or not in queue or not done. Actually make it 4
  icons. Add one for errored out deep dives."
- _Impl notes (capture-only, for when it's built):_ `deep_dives.status` already
  has exactly `queued` / `done` / `error` (migration 993); "not queued" = no row.
  The home query currently only fetches `status='done'` ext_ids (for the 🔬) —
  it'd fetch the **status per ext_id** instead and the tables would render a
  status icon column (with a legend), reusing the existing `.dd-mark` styling.
