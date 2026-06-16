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

## Working in this repo

This project follows a per-session protocol (session logs, verbatim prompt
history, Supabase migration numbering, git workflow). See
[`NEW_SESSION_INSTRUCTIONS.md`](./NEW_SESSION_INSTRUCTIONS.md) and
[`CLAUDE.md`](./CLAUDE.md). A SessionStart hook
(`.claude/hooks/session-start.sh`) injects the protocol at the start of every
session.

## Status

Foundation in place: the Supabase schema
(`supabase/migrations/999_initial_schema.sql`), a shared Python config/db layer,
and a passing test suite. The scraper crawl, the Claude ranking layer, and the
dashboard are next. See the latest file under `Session log/` for current state
and next steps.

> Strategy is governed by [`docs/ROADMAP.md`](./docs/ROADMAP.md): the miner is
> research infrastructure, time-boxed to ~20 hours, with one goal — **pick ONE
> validated extension to build a competitor against.**

> ⚠️ Scrape responsibly: respect the Chrome Web Store's terms and rate limits,
> back off on errors, and keep all secrets (Supabase keys) in environment
> variables — never commit them.
