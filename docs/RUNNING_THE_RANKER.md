# Running the Claude analysis (Windows)

The **"Run ExtensionMiner Ranking"** button runs **all the Claude analysis tasks**
over the extensions + reviews you've scraped, in one click:

1. **Ranking** — mines reviews for fixable complaints + "I'd pay if…" signals,
   scores each extension, writes the **`opportunities`** table (the dashboard's
   *Scored opportunities* card).
2. **Monetization** — web-searches each extension's pricing and estimates monthly
   revenue, writes the **`monetization`** table (the dashboard's *Pricing* +
   *Est. /mo* columns).

It's a separate step from scraping — run the **scraper first** so there are
reviews to analyze, then run this.

> Why a desktop button and not a dashboard button? The ranker is Python and calls
> the Anthropic API once per extension (slow), which can't run on Vercel. So it
> runs on your machine, where your `ANTHROPIC_API_KEY` lives.

## One-time setup
1. Make sure your `.env` (in the repo root) has:
   - `ANTHROPIC_API_KEY=…` (get one at <https://console.anthropic.com/>)
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (same as the scraper uses)
2. Drop the Desktop buttons (creates both scraper + ranking icons):
   ```
   scripts\create_desktop_shortcut.cmd
   ```

## Run it
Double-click **"Run ExtensionMiner Ranking"** on your Desktop (or
`scripts\run_ranker.cmd` in the repo). On first run it sets up the shared `.venv`
and installs dependencies; after that it's quick. It also auto-updates the code
(`git pull` of `main`) before each run, just like the scraper launcher.

When it finishes, the `opportunities` **and** `monetization` tables are updated,
and the dashboard reflects the new scores, pricing, and revenue estimates.

## What it does by default
Runs **both** Claude tasks (ranking + monetization, via `--monetize`) over the
**top 25 extensions by install count** — ranking covers those with at least 5
saved reviews. To change that, edit the `RUN_ARGS` line near the top of
`scripts\run_ranker.cmd`, or run by hand:

```bat
.venv\Scripts\python.exe run_ranker.py --monetize --log-dir logs   :: the default (rank + monetize)
.venv\Scripts\python.exe run_ranker.py --log-dir logs              :: ranking only (no web-search pass)
.venv\Scripts\python.exe run_ranker.py --limit 50 --monetize       :: do more extensions
.venv\Scripts\python.exe run_ranker.py --limit 5 --no-db --monetize :: dry run, no writes
```

> Heads-up: `--monetize` web-searches per extension, so the full run costs more
> and takes longer than ranking alone. Drop `--monetize` from `RUN_ARGS` if you
> want the button to do ranking only.

### Handy flags
| Flag | What it does |
|------|--------------|
| `--limit N` | How many extensions to score (by installs). Default 25. |
| `--min-reviews N` | Skip extensions with fewer than N saved reviews. Default 5. |
| `--max-reviews N` | How many reviews to send Claude per extension. Default 120. |
| `--monetize` | Also research each extension's **pricing / revenue** (web search) and write the `monetization` table the dashboard shows. |
| `--no-db` | Dry run: analyze + score, but don't write `opportunities`. |
| `--model NAME` | Anthropic model (default `ANTHROPIC_MODEL` or `claude-opus-4-8`). |
| `--log-dir logs` | Also write a timestamped log file. |

## Monetization research (pricing / revenue) on its own

The default button already runs monetization (it populates the dashboard's
**Pricing** + **Est. /mo** columns; needs migration **995** applied). To run
*only* the monetization pass — e.g. to refresh pricing without re-ranking:

```bat
.venv\Scripts\python.exe -m analysis.monetize --limit 25
```

### Exit codes
`0` ok · `2` no `ANTHROPIC_API_KEY` · `3` missing Supabase env (real run) · `1` other error.

## Troubleshooting
- **`ANTHROPIC_API_KEY isn't set`** — add it to `.env` (see setup above).
- **`0 extensions scored`** — likely nothing has ≥ 5 reviews yet; run the scraper
  first, or lower `--min-reviews`.
- **`No module named …`** — you ran it with the system Python; use
  `.venv\Scripts\python.exe run_ranker.py …` or the Desktop button.
