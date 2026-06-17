# ExtensionMiner

Scrape the **Chrome Web Store**, catalog every extension and its reviews, and
surface **competitive opportunities** through an interactive dashboard.

## The idea

Most extension catalogs tell you what's popular. ExtensionMiner is built to find
what's **beatable** — extensions with real demand but unhappy users, sitting in
the **~3-star range**, where reviews say things like *"if X worked, I'd pay for
this."* Those are the products worth building a competitor against.

## What it does

- **Scrapes the entire extension library** — name, developer, category, install
  count, rating, version, last updated, description, permissions, and more.
- **Logs every review** with full detail — **when** (timestamp), **what** (the
  review text), and **how many stars** (1–5).
- **Categorizes** extensions by store category and derived clusters.
- **Ranks & filters** in an interactive dashboard: highest-ranked,
  lowest-ranked, and the **mid-rated opportunity zone** (high installs + ~3
  stars + recurring complaints = a target worth overtaking).
- **Mines review text** for unmet-demand signals ("I'd pay if…", "wish it
  could…", "almost perfect but…").

## Architecture

| Layer | Tech |
|-------|------|
| Scraper | Python (`scraper/`) |
| Analysis & categorization | Python (`analysis/`) |
| Database | Supabase / Postgres (`supabase/`) |
| Dashboard | Next.js on Vercel (`dashboard/`) |

## Repo layout

```
scraper/      Python crawler for the Chrome Web Store
analysis/     Categorization, review mining, opportunity scoring
dashboard/    Next.js app (deployed to Vercel), reads from Supabase
supabase/     SQL migrations (numbered DOWN from 999)
Session log/  Per-session prompt history + handoff logs
```

## Run the scraper (Windows: one click)

The scraper runs **locally** (the Chrome Web Store is egress-blocked in the web
env). On Windows you don't need a terminal:

- **Run now:** double-click `scripts\run_scraper.cmd` — it bootstraps a venv,
  installs deps + Chromium on first run, crawls, writes to Supabase, and quits.
- **Run daily:** double-click `scripts\install_daily_task.cmd` once to register a
  Windows scheduled task.

Full guide (setup, `.env`, scheduling, troubleshooting):
[`docs/RUNNING_THE_SCRAPER.md`](./docs/RUNNING_THE_SCRAPER.md).

## Working in this repo

This project follows a per-session protocol (session logs, verbatim prompt
history, Supabase migration numbering, git workflow). See
[`NEW_SESSION_INSTRUCTIONS.md`](./NEW_SESSION_INSTRUCTIONS.md) and
[`CLAUDE.md`](./CLAUDE.md). A SessionStart hook
(`.claude/hooks/session-start.sh`) injects the protocol at the start of every
session.

## Status

Built so far: the Supabase schema (`supabase/migrations/999_initial_schema.sql`),
the DIY Playwright **scraper** (`scraper/`), the Claude **ranking layer**
(`analysis/`), and the Next.js **dashboard** (`dashboard/`) — with a passing test
suite (43). What's left is operational: run the scraper locally (the store is
egress-blocked in the web env), apply the schema to Supabase, and point Vercel at
`main`. See the latest file under `Session log/` for current state and next steps.

> Strategy is governed by [`docs/ROADMAP.md`](./docs/ROADMAP.md): the miner is
> research infrastructure, time-boxed to ~20 hours, with one goal — **pick ONE
> validated extension to build a competitor against.**

> ⚠️ Scrape responsibly: respect the Chrome Web Store's terms and rate limits,
> back off on errors, and keep all secrets (Supabase keys) in environment
> variables — never commit them.
