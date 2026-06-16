# scraper/

Python crawler for the Chrome Web Store.

Responsibilities:
- Enumerate as much of the extension library as reachable.
- For each extension, collect metadata (name, developer, category, install
  count, rating, rating count, version, last updated, description, permissions,
  URLs).
- Collect **every review** with **timestamp**, **text**, and **stars (1–5)**.
- Write results to Supabase (Postgres).

Guidelines:
- Scrape politely: rate-limit, back off on errors, cache responses, set a
  reasonable User-Agent.
- Keep Supabase credentials in environment variables (`.env`), never in code.

_Not yet implemented — see the latest `Session log/` entry for status._
