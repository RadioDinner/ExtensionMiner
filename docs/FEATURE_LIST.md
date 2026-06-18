# ExtensionMiner — Feature List (running backlog)

> A running list of features the user wants. **This is a capture-only backlog.**
> When the user says *"add this to the feature list"* (or anything like it), the
> item is appended here and **work does NOT start** until they explicitly ask for
> it. **Once a feature ships, REMOVE it from this list** (don't keep it as
> "done"). See CLAUDE.md §6 for the rule.

**Status legend:** 🆕 Proposed · 🔨 In progress · ❄️ On hold
(Shipped → deleted from this list.)

---

### 1. 🆕 Deep-dive status column in the extension list (4 icons)
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
