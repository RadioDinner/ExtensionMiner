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
| `run.py` | CLI (`python -m analysis.run`) |

## Run

```bash
pip install -r requirements.txt
# .env needs ANTHROPIC_API_KEY (+ SUPABASE_* unless --no-db). Model defaults to
# claude-opus-4-8; override with ANTHROPIC_MODEL or --model.

python -m analysis.run --limit 5 --no-db   # dry run: analyze + score, no writes
python -m analysis.run --limit 25          # real run: writes opportunities
```

This layer can run in the Claude-Code web env too — the Anthropic API is
reachable there (unlike the scraper). It needs data in Supabase first.

## Scoring rubric

Weights live at the top of `rank.py` and are meant to be tuned against real
outcomes (see `docs/ROADMAP.md` Phase 3): demand intensity (# independent
reviewers, heaviest) + willingness-to-pay + fixability + market size + a bonus
for the ~3★ opportunity zone, minus penalties for "just bad / abandoned" and
fixes that need a costly backend.
