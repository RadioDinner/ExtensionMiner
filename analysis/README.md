# analysis/

The **Claude ranking layer** (roadmap Phase 3 — the valuable part). Mines the
scraped reviews for *fixable* complaints + "I'd pay if…" signals, scores each
extension, and writes the `opportunities` table the dashboard renders.

## Pipeline

```
extensions + reviews (Supabase)
        │
        ▼  one structured Claude call per extension (messages.parse)
ExtensionAnalysis  (what-it-does, clusters, fixable?, WTP quotes, "just bad?" anti-signal)
        │
        ▼  deterministic, unit-tested scoring (rank.score_opportunity)
opportunities  (score, top complaint, WTP evidence, brief)  → Supabase
```

| File | Role |
|------|------|
| `schema.py` | Pydantic structured-output schema for Claude |
| `prompt.py` | System + per-extension user prompt |
| `rank.py` | `analyze_extension` (the one Claude call) + `score_opportunity` (pure, tested) + `rank_all` orchestration |
| `monetize.py` | Monetization research: `research_monetization` (one **web-search** Claude call → `MonetizationProfile`) + `monetize_all`; writes the `monetization` table the dashboard shows |
| `deepdive.py` | **Deep-dive pool**: `research_deep_dive` (one web-search call → `DeepDiveReport`: reviews + competitors + verdict) + `deep_dive_all`; processes only the extensions queued from the dashboard, writes the `deep_dives` table |
| `run.py` | CLI (`python -m analysis.run`; `--monetize` and `--deep-dive` add those passes) |

### Monetization (is it making money?)

`python -m analysis.monetize` web-searches each extension for its pricing
(free / freemium / paid / subscription / ads) and estimates monthly revenue,
writing the `monetization` table (migration **995**). Run it standalone, or add
`--monetize` to a ranking run to do both at once:

```bash
python -m analysis.monetize --limit 25            # research the top 25 by installs
python -m analysis.run --limit 25 --monetize      # rank AND research monetization
```

The dashboard's opportunity-zone table shows the pricing model + an estimated
monthly revenue per extension once this has run.

### Deep-dive pool (hand-picked, token-frugal)

The full deep dive — read the reviews closely **and** research the competitors —
is expensive, so it only runs on extensions you **hand-pick**. On a detail page
click **"🔬 Add to deep-dive pool"**; that queues a row in `deep_dives`
(migration **993**). Then the analysis layer processes just the queue:

```bash
python -m analysis.deepdive               # process everything queued
python -m analysis.run --deep-dive        # rank, then also process the pool
```

Each queued extension gets one web-search-backed Claude call → `DeepDiveReport`
(what it is, a deep review read, the **competitors** with pricing/strengths/
weaknesses, the opportunity, and a build/maybe/avoid verdict), written back to
its `deep_dives` row and shown on the detail page. The "Run Ranking" desktop
button runs this pass too (`--deep-dive`).

### Extension detail digest (`/reviews/<ext_id>`)

The per-extension page renders an **opportunity digest** above the raw reviews:
a plain **"what it does"** overview (the `what_it_does` field on
`ExtensionAnalysis`, stored in `opportunities.details`), the **clustered user
problems** (each complaint + how many distinct reviewers raised it + WTP
quotes, from `opportunities.details.clusters`), and the **full profitability
breakdown** (the complete `monetization` row — pricing tiers, est. users,
revenue range, confidence, basis). Each section hides itself if that data
isn't there yet, so the page still works before the ranking/monetization
passes have run.

## Run

On Windows, the easy way is the **"Run ExtensionMiner Ranking"** Desktop button
(from `scripts\create_desktop_shortcut.cmd`) → it runs `scripts\run_ranker.cmd`,
which sets up the venv and runs the ranker. Full walkthrough:
[`docs/RUNNING_THE_RANKER.md`](../docs/RUNNING_THE_RANKER.md). By hand:

```bash
pip install -r requirements.txt
# .env needs ANTHROPIC_API_KEY (+ SUPABASE_* unless --no-db). Model defaults to
# claude-opus-4-8; override with ANTHROPIC_MODEL or --model.

python -m analysis.run --limit 5 --no-db   # dry run: analyze + score, no writes
python -m analysis.run --limit 25          # real run: writes opportunities
# or the top-level shim: python run_ranker.py --limit 25 --log-dir logs
```

This layer can run in the Claude-Code web env too — the Anthropic API is
reachable there (unlike the scraper). It needs data in Supabase first.

## Scoring rubric

Weights live at the top of `rank.py` and are meant to be tuned against real
outcomes (see `docs/ROADMAP.md` Phase 3): demand intensity (# independent
reviewers, heaviest) + willingness-to-pay + fixability + market size + a bonus
for the ~3★ opportunity zone, minus penalties for "just bad / abandoned" and
fixes that need a costly backend.

### Review recency weighting (decay old reviews)

Old reviews usually describe old releases, so the demand term is **discounted
when the complaints driving it are stale**. `recency_factor(reviews)` averages a
per-review age-decay weight (`recency_weight`, buckets in `RECENCY_BUCKETS`:
≤3mo full weight → >3yr a 0.15 floor) over the extension's complaint reviews
(≤3★), and `score_opportunity(..., recency=…)` multiplies the demand term by it.
The multiplier is stored on `opportunities.recency_weight` (migration **994**)
and shown as the dashboard's *Recency* column. Scoring only — every review is
still stored regardless of age.

### Decline / complaint-trend detection (target weakening products)

A product whose reviews are getting **worse** is a better target. `trend_signal`
compares a recent window (~6mo) against a prior one (~6–18mo) and computes a
`decline_score` in [0, 1] from the **rating drop** plus the **rise in negative
(≤2★) reviews** (the "complaint surge"), needing at least a few dated reviews in
each window. It's stored on `opportunities` (with `recent_rating`,
`baseline_rating`, `complaint_trend` — migration **992**), feeds a small `score`
bonus (`W_DECLINE`), and surfaces on the dashboard as the *Trend* column +
"Declining only" filter + "Declining fastest" sort. Computed from the per-review
timestamps + stars already stored — no new scraping.
