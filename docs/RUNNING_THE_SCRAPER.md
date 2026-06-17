# Running the scraper (Windows)

The scraper runs on **your local machine** — the Chrome Web Store is
egress-blocked inside Claude-Code-on-the-web, so it can't run there. You don't
need to open PowerShell or activate anything; it's a double-click.

## One-time setup

1. Make sure **Python 3.11+** is installed and on your PATH
   (<https://www.python.org/downloads/> — tick *"Add python.exe to PATH"* during
   install).
2. Create your **`.env`** (once): copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL` — your project URL.
   - `SUPABASE_SERVICE_ROLE_KEY` — the **SECRET** key (`sb_secret_…`), *not* the
     publishable one. The database has RLS on with no policies, so only the
     secret key can read/write.
   - `TARGET_CATEGORIES` — comma-separated store category slugs to crawl
     (e.g. `productivity,developer-tools`).

That's it. You never run `pip install` or `playwright install` yourself — the
launcher does it the first time.

## Run it now (the "button")

Double-click:

```
scripts\run_scraper.cmd
```

The **first run** creates a private `.venv`, installs the Python dependencies,
and downloads the Chromium browser (a few minutes). Every run after that is
quick. It then crawls your categories, writes to Supabase, prints a summary, and
**quits**. A timestamped log is saved under `logs\`.

If anything goes wrong, the window **stays open** with a plain-English message
(missing `.env`, browser not installed, store unreachable, etc.) instead of
flashing a traceback and vanishing.

> **You clone the repo once.** It's a permanent folder on your machine — you do
> **not** re-clone to run again. After the first setup it's just double-click →
> run → quit, as often as you like, and the scheduled task does it daily.

### Make a Desktop button (optional, recommended)
So you never have to open the repo folder, run **`scripts\create_desktop_shortcut.cmd`**
once. It drops a **"Run ExtensionMiner Scraper"** icon on your Desktop that points
back at the launcher inside the repo. Double-click the Desktop icon any time to
run. (You can also just right-click `run_scraper.cmd` → *Send to* → *Desktop
(create shortcut)*.)

### What the daily preset does
By default the launcher runs `--preset daily`: a **full crawl of the store's
whole category taxonomy** — it reads the category list from the store's own nav
(`--all-categories`) and scrolls each category until no new extensions appear, so
it discovers as many extensions as the category pages will lazy-load. For an
extension that's **already in the database**, the reviews are re-checked and
**only new ones are added** (upserts dedupe on `extension_id + review_uid`); if
there's nothing new, it effectively moves on. Newly listed extensions get picked
up automatically. It also records a daily rating/install **snapshot** per
extension so you can track trajectory over time.

> Heads-up: the whole-taxonomy crawl is **long** (polite 3s/page rate limit). A
> first full run can take hours — that's expected for an overnight scheduled job.
> Set `TARGET_CATEGORIES` + drop `--all-categories` in `RUN_ARGS` if you want a
> smaller, faster run while testing.

To change behavior, edit the `RUN_ARGS` line near the top of
`scripts\run_scraper.cmd`. Examples are in the comments there.

## Run it every day (scheduled task)

Double-click **once**:

```
scripts\install_daily_task.cmd
```

This registers a Windows Scheduled Task named **"ExtensionMiner Daily Scrape"**
that runs the launcher every day at **03:00** (edit the `RUNTIME` line in that
file to change the time). It runs unattended (no pause). Useful commands:

```bat
schtasks /Query /TN "ExtensionMiner Daily Scrape" /V /FO LIST   :: inspect it
schtasks /Run   /TN "ExtensionMiner Daily Scrape"               :: run it now
```

To remove it, double-click `scripts\uninstall_daily_task.cmd`.

### Run when logged off (optional)
By default the task only runs while you're logged in. To run it whether or not
you're logged on, open **Task Scheduler** → find *ExtensionMiner Daily Scrape* →
**Properties** → General → select **"Run whether user is logged on or not"** (it
will ask for your Windows password). Make sure the machine is awake at the
scheduled time (or enable *"Wake the computer to run this task"* under
Conditions).

## Running by hand (optional)

From the repo root, with the venv active (or using `.venv\Scripts\python.exe`):

```bat
python run_scraper.py --preset daily --log-dir logs
:: equivalent:
python -m scraper.run  --preset daily --log-dir logs
```

Do **not** run `python scraper\run.py` directly — that breaks Python's relative
imports. Use `run_scraper.py` or the `-m scraper.run` form above.

### Handy flags
| Flag | What it does |
|------|--------------|
| `--preset daily` | Full refresh crawl of configured categories (the scheduled default). |
| `--categories productivity developer-tools` | Crawl specific category slugs. |
| `--max-extensions N` | Cap extensions per category (`0` = no cap). |
| `--no-db` | Dry run: fetch + parse, write nothing (great for a quick test). |
| `--skip-existing` | Skip extensions already in the DB (fast resume). |
| `--refresh-after-days N` | Re-scrape only rows older than N days. |
| `--log-dir logs` | Also write a timestamped log file. |
| `--log-level DEBUG` | More verbose output. |

## Troubleshooting

**"This doesn't look like the ExtensionMiner repo" / `Could not open requirements
file: ...\requirements.txt`** — you ran a copy of `run_scraper.cmd` that's *not*
inside the repo. The launcher treats its own parent folder as the repo root, so
it must live in `…\ExtensionMiner\scripts\`. Move it back there (or `git pull`
the branch so it's already present) and run it from there. Delete any stray
`.venv` folder a misplaced run created (e.g. in `C:\Users\<you>\.venv`).

### Exit codes
`0` success · `2` missing Supabase config · `3` Chromium not installed ·
`4` store unreachable · `1` other error. Task Scheduler shows this as the
*Last Run Result*.
