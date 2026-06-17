# ExtensionMiner — Project Memory (CLAUDE.md)

> This file is loaded automatically at the start of every session. It defines
> how this project works and the protocol every session must follow. The
> canonical, user-authored copy of the session protocol lives in
> [`NEW_SESSION_INSTRUCTIONS.md`](./NEW_SESSION_INSTRUCTIONS.md). A SessionStart
> hook (`.claude/hooks/session-start.sh`) also injects this protocol into
> context at the start of every Claude Code session.

---

## 1. What this project is

ExtensionMiner scrapes the **Chrome Web Store** to build a complete, queryable
catalog of browser extensions, then surfaces **competitive opportunities**
through an interactive dashboard.

**The strategic goal:** find extensions worth building a competitor against and
overtaking. The sweet spot is the **~3-star range** — products with real demand
but unhappy users, where reviews say things like *"if X worked, I'd pay for
this."* These mid-rated, high-volume extensions are the gold the dashboard is
built to surface.

### Current direction (decided Session 2 — see [`docs/ROADMAP.md`](./docs/ROADMAP.md))
The canonical strategy doc is `docs/ROADMAP.md`. It frames the miner as
**research infrastructure, not the product** — the product is the fixed
extension built afterward — and time-boxes the miner to **~20 hours** with one
success condition: **pick ONE validated target to build.** Active decisions:
- **Scope:** *lean now, product foundation* — start with **1–3 categories** and
  the goal of picking ONE target, but build on Supabase + Next.js so it can
  scale to the full-catalog vision later.
- **Data source:** **DIY Python scraper** (Playwright), run politely.
- **Storage:** **Supabase (Postgres)** (not SQLite — so the Vercel dashboard
  reads from it directly).
- **Ranking layer:** **Claude API** — the valuable part; mine reviews for
  fixable complaints + "I'd pay if…" signals.
- **Env constraint:** the Chrome Web Store is **egress-blocked (HTTP 403) in the
  Claude-Code-on-the-web environment**, so the **scraper must run locally** (or
  in an env with a wider network policy). The schema, ranking layer, and tests
  run fine in the web env (PyPI + the Anthropic API are reachable).

### Core capabilities
- **Scrape the entire extension library** — metadata for every extension we can
  reach (name, developer, category, install count, rating, rating count,
  version, last updated, description, permissions, website, etc.).
- **Log every review** with full detail: **when** (timestamp), **what** (review
  text), and **how many stars** (1–5). Reviews are the primary signal source.
- **Categorize** extensions (store category + derived/clustered categories).
- **Interactive dashboard** to rank and filter extensions: highest-ranked,
  lowest-ranked, and — most importantly — the **mid-rated opportunity zone**
  (e.g. 2.5–3.5 stars with high install counts and recurring complaint themes).
- **Opportunity signals**: mine review text for "I'd pay if…", "wish it
  could…", "almost perfect but…" style phrases that indicate unmet demand.

---

## 2. Tech stack & architecture

| Layer | Choice | Notes |
|-------|--------|-------|
| Scraper | **Python (Playwright, DIY)** | Crawls the Chrome Web Store politely (rate-limited, cached). Writes to Supabase. Must run where the store is reachable. |
| Ranking layer | **Claude API (Anthropic)** | Mines reviews for fixable complaints + "I'd pay if…" signals; writes scored `opportunities`. The valuable part. |
| Data analysis / categorization | **Python** | Pandas for slicing, scoring, clustering. |
| Database | **Supabase (Postgres)** | All scraped data lives here. Schema in `supabase/migrations/` (numbered DOWN from 999). |
| Dashboard | **Next.js (React) on Vercel** | Reads from Supabase. Renders the interactive dashboard. |
| Hosting | **Vercel** | Dashboard deployment target. |

> The dashboard framework was left to "whatever is best for Vercel" — **Next.js**
> is the canonical Vercel framework and the working assumption. Revisit if the
> user prefers something lighter (e.g. static export + a charting lib).

### Live infrastructure (provisioned Session 1)
- **Supabase project:** ref `jagtupajcgdvehqfltom`. The Supabase MCP server is
  configured project-scoped in `.mcp.json` (HTTP transport); each user must
  authenticate it locally via `claude` → `/mcp` (OAuth — not committed).
- **Dashboard (Vercel):** the Next.js app lives in `dashboard/`. Vercel must be
  set with **Root Directory = `dashboard`**, **Framework = Next.js**, **Production
  Branch = `main`**, and env vars `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  (server-side; RLS is locked to the service role). The build is request-time
  (`force-dynamic`) so it succeeds even before Supabase is wired.

### Intended repo structure
```
ExtensionMiner/
├── CLAUDE.md                     # This file — project memory (auto-loaded)
├── NEW_SESSION_INSTRUCTIONS.md   # Canonical session protocol (user-authored)
├── README.md                     # Human-facing project overview
├── requirements.txt              # Python dependencies (scraper + analysis)
├── .env.example                  # Env template (Supabase + Anthropic keys)
├── docs/
│   └── ROADMAP.md                # Canonical strategy doc (review-miner roadmap)
├── .claude/
│   ├── settings.json             # Registers the SessionStart hook
│   └── hooks/session-start.sh    # Injects session protocol + latest handoff
├── common/                       # Python: shared config + Supabase client
├── scraper/                      # Python: Chrome Web Store crawler (Playwright)
├── analysis/                     # Python: categorization, review mining, ranking
├── tests/                        # Pytest suite
├── dashboard/                    # Next.js app deployed to Vercel
├── supabase/
│   └── migrations/               # SQL migrations (numbered DOWN from 999)
│       └── 999_initial_schema.sql
└── Session log/
    └── Session N/                # Per-session prompt_history.txt + session_log.txt
```

### Data model (implemented in `supabase/migrations/999_initial_schema.sql`)
- `extensions` — one row per extension (store id, name, developer, category,
  rating avg, rating count, install count, version, last_updated, description,
  permissions, urls, first_seen, last_scraped).
- `reviews` — one row per review (extension_id FK, author, **stars 1–5**,
  **review text**, **review timestamp**, language, helpful_count, scraped_at).
- `categories` — store categories and/or derived clusters.
- `rating_snapshots` — optional time series of an extension's aggregate rating
  so we can track trajectory.
- `opportunities` — derived/scored rows flagging mid-rated, high-demand targets.

### Responsible scraping
The Chrome Web Store has Terms of Service. Scrape **politely**: respect rate
limits, identify a reasonable User-Agent, back off on errors, cache responses,
and avoid hammering endpoints. Keep all secrets (Supabase keys) in `.env` /
environment variables — never commit them.

---

## 3. Start-of-session protocol (FOLLOW EVERY SESSION)

Full text in `NEW_SESSION_INSTRUCTIONS.md`. Operational summary:

1. **Session log folder** — Look in `Session log/`, find the highest existing
   `Session N`, and create the next one: `Session log/Session <N+1>/`.
2. **Prompt history** — Create `prompt_history.txt` in that folder and log
   **every** user prompt **VERBATIM** (exact words, no paraphrasing), numbered,
   one blank line between entries. **Update it after every prompt**, not just at
   the end.
3. **Read the previous handoff** — Read the most recent prior
   `Session log/Session N/session_log.txt` before starting work so you know
   where things left off and what's open.
4. **Session handoff log** — When the session wraps up, write `session_log.txt`
   in the current session folder documenting: changes made (files
   created/modified/deleted), directional decisions, open items/unresolved
   questions, key context for next session, and current project state.
5. **Commit & push session logs before ending the session.**

> A SessionStart hook surfaces the latest `session_log.txt` and the next session
> number automatically — but you are still responsible for performing the steps
> above (creating folders, logging prompts verbatim, writing the handoff).

---

## 4. Supabase migration numbering (IMPORTANT — counts DOWN)

- Migrations in `supabase/migrations/` count **DOWN from 999**, not up.
- **999 is the OLDEST / foundational** migration. Newer migrations get **LOWER**
  numbers.
- Before adding a migration: `ls supabase/migrations/`, find the **LOWEST**
  existing number, and use **(lowest − 1)**.
- Example: lowest existing is `965_foo.sql` → next is `964_<name>.sql`.
- Do **NOT** use "highest + 1" — that collides and is wrong.
- Creating several in one session? Keep decrementing: 964, 963, 962, …

---

## 5. Git workflow

- Default: **merge and push to `main`** in a session unless told to use a branch.
- Always **commit and push the session logs before ending** a session.
- **Branch override:** if the harness/task designates a specific feature branch
  for the active session, develop and push there instead of `main`, and do not
  push elsewhere without explicit permission. (This session was assigned the
  branch `claude/optimistic-babbage-bt680w`.)
- Do **not** open a pull request unless the user explicitly asks for one.

---

## 6. Feature list / backlog (CAPTURE-ONLY — do not auto-build)

- The user keeps a running feature backlog in [`docs/FEATURE_LIST.md`](./docs/FEATURE_LIST.md).
- **Rule:** when the user says *"add this to the feature list"* — or anything
  like it (*"add to the backlog"*, *"put this on the feature list"*, etc.) —
  **just append the item to `docs/FEATURE_LIST.md` and STOP. Do NOT begin
  implementing it.** Capture the title, a faithful description, and any
  implementation hints the user gave; mark it 🆕 Proposed.
- Only start building a backlog item when the user **explicitly** asks for that
  item to be worked on/implemented.
- Keep entries numbered and in the existing format; don't reorder or delete
  items unless asked (mark status changes instead: 🔨 In progress, ✅ Done).

---

## 7. Notes for future sessions
- These instructions may be updated by the user at any time — re-read
  `NEW_SESSION_INSTRUCTIONS.md` if behavior seems off.
- Keep `.env`/secrets out of git. Add a `.env.example` when wiring Supabase.
