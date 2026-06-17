# analysis/

The **Claude ranking layer** (roadmap Phase 3 — the valuable part). Mines the
scraped reviews for *fixable* complaints + "I'd pay if…" signals, scores each
extension, and writes the `opportunities` table the dashboard renders.

## Pipeline

```
extensions + reviews (Supabase)
        │
        ▼  one structured Claude call per extension (messages.parse)
ExtensionAnalysis  (clusters, fixable?, WTP quotes, "just bad?" anti-signal)
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
| `run.py` | CLI (`python -m analysis.run`; `--monetize` also runs the monetization pass) |

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
