# supabase/

Supabase (Postgres) database for ExtensionMiner. All scraped data lives here.

## Migrations (`migrations/`) — numbered DOWN from 999

⚠️ **This project numbers migrations DOWN, not up.**

- `999` is the **OLDEST / foundational** migration.
- Newer migrations get **LOWER** numbers.
- Before adding one: `ls supabase/migrations/`, find the **LOWEST** existing
  number, and name the new file **(lowest − 1)**.
  - Example: lowest is `965_foo.sql` → next is `964_<name>.sql`.
- Do **NOT** use "highest + 1" — that collides with existing files.
- Creating several in one session? Keep decrementing: 964, 963, 962, …

## Planned schema (to be implemented)

- `extensions` — one row per extension.
- `reviews` — one row per review (stars 1–5, text, timestamp).
- `categories` — store categories + derived clusters.
- `rating_snapshots` — optional rating time series per extension.
- `opportunities` — scored, mid-rated competitive targets.

_No migrations yet — the first foundational migration will be `999_*.sql`._
