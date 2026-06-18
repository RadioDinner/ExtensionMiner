# ExtensionMiner — User Guide

> The complete manual for this system: what it is, how the pieces fit, how to run
> it, and how to use every part of the dashboard. If you're coming back to this
> project after a while, **start here.** For the strategy/why, see
> [`ROADMAP.md`](./ROADMAP.md); for the project rules/session protocol, see
> [`../CLAUDE.md`](../CLAUDE.md). There's also an in-app version at
> **`/help`** on the dashboard.

---

## 1. What it is (and the one goal)

ExtensionMiner scrapes the **Chrome Web Store**, builds a queryable catalog of
extensions + their reviews in Supabase, runs a **Claude ranking layer** over the
reviews to score *opportunities*, and surfaces them in a **dashboard**.

**The point:** find **ONE** extension worth building a competitor against and
overtaking. The sweet spot is the **~3-star "opportunity zone"** — products with
real demand but unhappy users, where reviews say *"if X worked, I'd pay for
this."* High installs + mediocre rating + fixable, recurring complaints = a
target.

The miner is **research infrastructure, not the product.** The product is the
fixed extension you build afterward.

---

## 2. The mental model (architecture)

```
  Chrome Web Store
        │  scrape (Python + Playwright, runs LOCALLY)
        ▼
  Supabase (Postgres)  ──────────────┐
   extensions, reviews, …            │  read (service-role)
        │  rank (Python + Claude API)│
        ▼                            ▼
   opportunities, monetization,   Dashboard (Next.js on Vercel)
   deep_dives                     home / detail / settings / diagnostics / help
```

| Layer | Tech | Where it runs |
|-------|------|---------------|
| Scraper | Python (Playwright) | **Your machine** (the store is egress-blocked in the cloud env) |
| Ranking layer | Python + **Claude API** | Your machine (Anthropic API is reachable anywhere) |
| Database | **Supabase** (Postgres) | Hosted |
| Dashboard | **Next.js** | **Vercel** (reads Supabase server-side with the service-role key) |

> **Why local?** The Chrome Web Store returns HTTP 403 from the Claude-Code-on-
> the-web environment, so the scraper must run where the store is reachable. The
> schema, ranking layer, and tests all run fine in the cloud env.

---

## 3. The end-to-end workflow

1. **One-time setup** — fill `.env`, apply the SQL migrations, deploy the
   dashboard (see §4).
2. **Configure the crawl** — open the dashboard's **Scraper settings** tab, set
   categories/caps and (recommended) turn on the **opportunity-zone review gate**
   and **skip-already-saved-reviews**. Save.
3. **Scrape** — run the scraper locally (the **Run Scraper** button) → fills
   `extensions` + `reviews`.
4. **Rank** — run the ranking layer locally (the **Run Ranking** button) →
   fills `opportunities`, `monetization`, and any queued `deep_dives`. Runs are
   **incremental** (only new extensions) unless you flip the override.
5. **Explore** — open the dashboard. Work the **Opportunity zone**: sort/filter,
   **dismiss** ones that aren't realistic targets (they backfill), open promising
   ones to read reviews + the **opportunity digest**.
6. **Deep dive** — for the few finalists, click **🔬 Add to deep-dive pool** on
   their detail page, re-run ranking, then read the competitor research + verdict.
7. **Pick ONE** and go build it.

---

## 4. One-time setup

### Environment variables (`.env` in the repo root)
```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_…      # the SECRET key, NOT the publishable one
ANTHROPIC_API_KEY=sk-ant-…                 # for the ranking layer
# optional scraper knobs:
SCRAPER_RATE_LIMIT_SECONDS=3
TARGET_CATEGORIES=productivity/tools,lifestyle/shopping
ANTHROPIC_MODEL=claude-opus-4-8
```
Keep `.env` out of git (it is, by `.gitignore`). The dashboard needs the same
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set in its host (Vercel env vars).

### Database migrations
SQL lives in `supabase/migrations/`, **numbered DOWN from 999** (999 is the
oldest/foundational; newer migrations get **lower** numbers). Apply them all to
your Supabase project. Current set:

| # | Adds |
|---|------|
| 999 | initial schema (extensions, reviews, categories, rating_snapshots, opportunities) |
| 998 | reviews unique constraint (dedupe) |
| 997 | successor links (same product re-published under a new id) |
| 996 | reviews.helpful_ranked flag |
| 995 | monetization table |
| 994 | opportunities.recency_weight |
| 993 | deep_dives pool |
| 992 | opportunities decline/trend columns |
| 991 | app_settings (ranking toggle + scraper settings) |
| 990 | zone_exclusions (dismiss-from-zone) |
| 989 | deep_dive_studies (Layer 2 + 3 skill-driven research uploads) |
| 988 | review_analysis (Layer 0 review-legitimacy pre-screen) |

> **After applying migrations, if a dashboard section looks blank**, reload the
> PostgREST schema cache: Supabase → Project Settings → API → **Reload schema**
> (or `NOTIFY pgrst, 'reload schema';`). The dashboard degrades gracefully when a
> migration is missing, so a blank section usually means "not applied yet" or
> "stale cache."

### Dashboard (Vercel)
Root Directory = `dashboard`, Framework = Next.js, Production Branch = `main`,
env vars `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. The build is request-time
(`force-dynamic`), so it deploys even before data exists. Visit **`/diagnostics`**
to confirm the connection.

### Windows one-click launchers
`scripts\create_desktop_shortcut.cmd` drops two Desktop buttons:
**Run Scraper** and **Run ExtensionMiner Ranking**. Both auto-update the code
(`git pull main`) and set up the venv on first run.

---

## 5. The scraper

Crawls categories → extension detail pages → review sub-pages, and upserts into
Supabase. It's **polite**: one shared rate limiter (default 3s between requests),
an on-disk HTML cache, robots.txt respected, dedupe on re-runs.

### How to run it
- **Easiest:** set things in the **Scraper settings** dashboard tab, then click
  the **Run Scraper** button (it runs `python -m scraper.run --use-saved-settings`).
- **By hand:** `python -m scraper.run [flags]`. Useful flags: `--categories`,
  `--all-categories`, `--max-extensions N`, `--concurrency N`, `--follow-related`,
  `--refresh`, `--skip-existing`, `--no-db` (dry run), `--no-headless` (watch it),
  `--preset daily` (full-store crawl).

### Scraper settings tab (`/scraper-settings`)
Full control over the crawl, saved in Supabase (`app_settings.scraper_settings`)
and read by the scraper with `--use-saved-settings`. Key settings:

- **Only save reviews for in-zone extensions** (the *zone review-gate*) — the big
  speedup. The scraper still reads each extension's cheap detail page, but only
  pays the **expensive review fetch** when the overall rating is inside the zone
  (default 2.5–3.5★). Out-of-zone extensions still get their metadata + a rating
  snapshot saved, so they're tracked and can re-qualify later.
- **Skip reviews if ≥ N already saved** — skip the review fetch when we already
  have ≥ N reviews for an extension **and** its rating count hasn't grown since
  the last scrape (no new ratings ⇒ no new reviews). 0 = off; try 10. Great for
  repeat crawls.
- Categories, max per category / total, concurrency, rate limit, follow-related,
  refresh, skip-existing, refresh-after-days, and the review-depth knobs.

### Making it faster (levers, by payoff)
1. **Zone review-gate + skip-already-saved** — avoid most review fetches.
2. **`--concurrency N`** — parallel browser workers overlap the slow on-page work
   (they share one rate limiter, so the request rate stays polite).
3. **Lower the rate limit** (less polite) — `SCRAPER_RATE_LIMIT_SECONDS` or the
   setting.
4. **`--skip-existing` / refresh-after-days** — don't re-scrape what's fresh.
5. **Trim review depth** — fewer `Load more` clicks / scrolls / no multi-sort.

---

## 6. The ranking layer (the valuable part)

`python -m analysis.run` reads extensions + reviews and asks Claude to mine the
reviews into scored **opportunities**. The **Run Ranking** button runs all three
passes:

1. **Ranking** → `opportunities` (score, top fixable complaint, WTP evidence,
   recency weight, decline/trend, a one-paragraph brief + a "what it does"
   overview). One structured Claude call per extension.
2. **Monetization** (`--monetize`) → `monetization` (pricing model, est. monthly
   revenue range, confidence). One **web-search** Claude call per extension.
3. **Layer 0 review-legitimacy** (on by default when the DB is reachable) → for
   every Opportunity-Zone extension, reads the reviews (weighted to **recent +
   helpful**) and judges **why** the rating is what it is. A low rating is only an
   *opportunity* if it comes from real, fixable product problems — if it's
   review-bombing (e.g. kids angry at a school filter) or a competitor attack,
   Layer 0 marks it **low-legitimacy** and the dashboard **demotes it in the
   zone**. Written to `review_analysis`. Skip with `--skip-layer0`.
4. **Deep-dive pool** (Layer 1, on by default when the DB is reachable) →
   processes the extensions you **queued** from the dashboard: a deep read of the
   reviews + **competitor research** + a build/maybe/avoid verdict, to `deep_dives`.

> **Deep-dive layers (0–3).** The deep dive is layered and the manual layers are
> **sequential**: **Layer 0** (auto review-legitimacy, above) → **Layer 1** (the
> pool, above) → **Layer 2** (deep competitor study) → **Layer 3** (financial
> study). Layers 2 and 3 are **skill-driven** — see §7.

### Incremental by default + the override toggle
Re-running is **cheap**: the ranking and monetization passes only analyze
**newly added** extensions (no `opportunities`/`monetization` row yet), so
back-to-back runs don't re-spend tokens. The mode is a **toggle saved in
Supabase**, flipped from the dashboard's **"Ranking mode"** control:

- **⚡ Incremental — new only** (default): score only newly added extensions.
- **🔁 Full re-run (override ON)**: re-analyze the whole top-N, overwriting.

Flip it on, run once, flip it back. The CLI `--force` forces a full re-run
regardless of the toggle. The deep-dive pool is always queue-driven (re-queue an
extension from its detail page to re-run its dive).

### Cost control
`--limit N` (default 25) caps how many extensions each pass hits;
`--min-reviews N` (default 5) skips thin extensions. Drop `--monetize` to skip
the pricing web-search; `--skip-deep-dive` to skip the pool this run.

---

## 7. The dashboard, page by page

### Home (`/`)
- **Stats** — total extensions, reviews, and how many sit in the opportunity zone.
- **Ranking mode toggle** — incremental vs. full re-run (§6).
- **Rating distribution** — half-star histogram; gold bars are the 2.5–3.5★ zone.
- **Rating vs installs scatter** — demand (installs, log) vs satisfaction
  (rating); gold dots in the shaded band are the targets. **Click a dot** to open
  that extension. Dots that stack at the same spot show a **count** — click one
  and the chart **pops open into a detailed grid** of those extensions (each a
  mini-card linking to its page). **⤢ Expand** opens a larger, labeled view.
- **★ Opportunity zone** — the curated top-25 in the 2.5–3.5★ band. Click any
  column header to **sort**, use the **filters** (installs, rating band, pricing,
  category, has-saved-reviews), click a name to read its saved reviews. Each row
  has a **✕** to dismiss it (see §8) and a **Deep dive** status column.
- **Scored opportunities** — Claude-ranked targets with the top fixable complaint,
  complaint type, fixability, **Recency** (how fresh the complaints are),
  **Trend** (is it getting worse?), pricing, and deep-dive status. Filter by
  complaint type / pricing; sort by score or "declining fastest."
- **Community-upvoted reviews** — reviews the store flagged *Helpful* (complaints
  people agree with), lowest-star first.
- **Lowest / Highest rated** — quick reference tables.

### Extension detail (`/reviews/<ext_id>`)
- **🧠 Deep-dive layers** — the layered research stack for this extension:
  - **🧪 Layer 0 — Review legitimacy** (automatic): why the rating is good/bad, a
    legitimacy %, the dominant cause (product issues / review-bombing / competitor
    attack / off-topic), and a note on the recent-vs-older trajectory.
  - **🔬 Layer 1 — Quick competitive read**: the **Add to deep-dive pool** button
    (queue/re-queue/remove); researched by the ranking layer (§6).
  - **🔭 Layer 2 — Deep competitor study** *(skill-driven; needs Layer 1)*: click
    **Generate research prompt**, **Copy** it into a Claude session with the
    **deep-research skill**, run it, **export the PDF**, then **upload** it back
    (or paste the text). The dashboard parses the narrative **and** the structured
    competitors/opportunities out of the report.
  - **💰 Layer 3 — Financial study** *(skill-driven; needs Layer 2)*: same flow,
    focused on how the extension makes money and how competitors are attacking it
    (free-alternative land-grabs, pricing openings).
- **Layer 2 / 3 reports** (once uploaded) — executive summary + verdict, the
  target's strengths/weaknesses, the **competitors** as a force-directed **graph**
  + rich cards, the **opportunities** breakdown, financials (Layer 3), sources,
  and the full narrative report (collapsible).
- **Opportunity digest** — a plain "what it does" overview, the **clustered user
  problems** (each complaint + how many distinct reviewers raised it + verbatim
  "I'd pay if…" quotes), and the full **monetization breakdown**.
- **Saved reviews** — every review we stored, sortable by date/rating.

### Scraper settings (`/scraper-settings`) — §5.
### Help (`/help`) — the in-app version of this guide.
### Diagnostics (`/diagnostics`)
Connection check: which env vars/keys are set, per-table row counts + errors, and
a **Deep-dive pool** panel (queued/done/error counts + the exact embed the home
page uses) that explains why the 🔬 does or doesn't appear. Two more panels confirm
the new migrations applied + the schema cache is fresh: **Layer 0 — review
legitimacy** (rows screened, how many were demoted for low legitimacy, and the zone
embed test) and **Deep-dive studies — Layer 2 & 3** (queued/done per layer). Your
first stop when something looks wrong.

---

## 8. How-tos & quick tips

- **Scrape only the opportunity zone** → Scraper settings → *Only save reviews
  for in-zone extensions* ON. You still catalog every extension's metadata; you
  just skip reviews for the ones outside 2.5–3.5★.
- **Re-run the scraper without re-fetching everything** → turn on *Skip reviews
  if ≥ N already saved* (e.g. 10). Only extensions with new ratings re-fetch.
- **Re-rank without burning tokens** → leave Ranking mode on **Incremental**. To
  re-score everything (e.g. after tuning the rubric), flip to **Full re-run**,
  run once, flip back — or run `--force` from the CLI.
- **Curate the zone** → hit **✕** on a row that isn't a realistic target (e.g.
  Chrome Remote Desktop — 35M installs, Google-owned → *Publisher owned*). It
  drops out and the next candidate **backfills** to keep the list at 25. Bring it
  back via **Show dismissed from zone → restore**.
- **Deep-dive a finalist** → on its detail page, **🔬 Add to deep-dive pool**,
  then run the ranking layer. When it finishes (status `done`), the detail page
  shows the competitor graph + verdict and a 🔬 appears in the lists.
- **Read the scatter fast** → big gold dots high up = lots of demand, mediocre
  rating = your zone. Click a stacked dot to fan it out into a grid.
- **Something's blank?** → open **/diagnostics**. Usual causes: migration not
  applied, **stale PostgREST schema cache** (reload it), wrong Supabase key
  (must be the *service_role / secret* key, not the anon/publishable one), or the
  ranker/scraper simply hasn't run yet.

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Dashboard shows 0 rows | Wrong key (use the **service_role/secret** key, not anon/publishable), or `SUPABASE_URL` points at a different project. See `/diagnostics`. |
| A section is blank after applying a migration | **Stale PostgREST schema cache** — reload it (Supabase → API → Reload schema). |
| 🔬 / deep-dive section missing | No completed deep dive yet (queue one + run the pool), or stale cache. `/diagnostics` → Deep-dive pool panel tells you which. |
| Layer 2/3 "locked" | The layers are sequential — finish Layer 1 before Layer 2, Layer 2 before Layer 3. |
| Layer 2/3 upload: "no structured data block" | The deep-research output didn't end with the JSON block — re-run with the **generated prompt** (it asks for the block), or paste the report text including that block. |
| PDF upload fails to parse | Use the **"…or paste the report text instead"** box (the report's JSON block is what matters). |
| Scraper: HTTP 403 / can't reach store | The store is egress-blocked in the cloud env — run the scraper **locally**. |
| Scraper: "No module named playwright" | `pip install -r requirements.txt && python -m playwright install chromium` (the launcher does this). |
| Ranking: "ANTHROPIC_API_KEY isn't set" | Add it to `.env`. |
| "0 extensions scored" | Nothing has ≥ `--min-reviews` reviews yet — scrape first, or lower it. |

---

## 10. Data model (Supabase tables)

- **extensions** — one row per extension (id, ext_id, name, developer, category,
  rating, rating_count, install_count, version, last_updated, description,
  permissions, urls, first_seen, last_scraped, successor_of).
- **reviews** — one per review (extension_id, author, **stars 1–5**, body,
  reviewed_at, helpful_ranked, …). Deduped on (extension_id, review_uid).
- **rating_snapshots** — time series of an extension's aggregate rating/installs.
- **opportunities** — Claude's scored row per extension (score, top_complaint,
  complaint_type, fixable, demand_intensity, wtp_evidence, recency_weight,
  decline_score/recent_rating/baseline_rating/complaint_trend, brief, details).
- **monetization** — pricing model, paid tier, price range, est. users + monthly
  revenue range, confidence, sources.
- **review_analysis** — Layer 0 (status, **legitimacy** 0–1, primary_cause,
  verdict, summary, categories breakdown, sentiment_note). Drives zone demotion.
- **deep_dives** — Layer 1, the hand-picked research pool (status queued/done/error,
  what_it_is, review_summary, competitors, opportunity, recommendation, sources).
- **deep_dive_studies** — Layers 2 & 3 (one row per extension+`layer`): the
  generated `prompt`, the uploaded `report_md`, summary, recommendation,
  competitors, opportunities, financials (L3), sources, parse_warning.
- **app_settings** — key/value (`ranking_force_rerun`, `scraper_settings`).
- **zone_exclusions** — extensions dismissed from the zone (+ reason).
- **categories** — store categories / derived clusters.

---

## 11. Glossary

- **Opportunity zone** — extensions rated **2.5–3.5★** with real install volume:
  demand + dissatisfaction = a target.
- **WTP ("I'd pay if…")** — willingness-to-pay signals mined from review text;
  the strongest demand evidence.
- **Demand intensity** — how many *independent* reviewers raise the same fixable
  complaint.
- **Recency weight** — discounts the demand term when the driving complaints are
  old (old reviews describe old releases).
- **Decline / trend** — is the extension getting *worse*? Recent reviews vs. a
  prior window; a weakening incumbent is a better target.
- **Deep dive** — opt-in, token-frugal comprehensive research (reviews +
  competitors + verdict) for hand-picked finalists.
- **Successor link** — when the same product is re-published under a new ext_id,
  the rows are linked so history isn't lost.

---

## 12. Where things live (repo map)

```
ExtensionMiner/
├── CLAUDE.md                  # project memory + session protocol
├── docs/
│   ├── GUIDE.md               # THIS file (the manual)
│   ├── ROADMAP.md             # strategy / why
│   ├── RUNNING_THE_RANKER.md  # ranking-layer run guide
│   └── FEATURE_LIST.md        # capture-only backlog
├── common/                    # config + Supabase client/helpers (db.py)
├── scraper/                   # Playwright crawler (run.py, crawl.py, parse.py, …)
├── analysis/                  # Claude layer (run.py, rank.py, monetize.py, deepdive.py)
├── tests/                     # pytest suite
├── dashboard/                 # Next.js app (app/, lib/) deployed to Vercel
├── supabase/migrations/       # SQL, numbered DOWN from 999
└── scripts/                   # Windows launchers (run_scraper.cmd, run_ranker.cmd)
```

Component-level docs: `scraper/README.md`, `analysis/README.md`, and
`docs/RUNNING_THE_RANKER.md` go deeper on each.
