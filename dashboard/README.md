# dashboard/

Interactive dashboard, built with **Next.js** and deployed to **Vercel**.
Reads scraped data from Supabase.

Responsibilities:
- Browse and filter the extension catalog.
- Rank extensions: **highest-ranked**, **lowest-ranked**, and the
  **mid-rated opportunity zone** (high installs + ~3 stars + recurring
  complaints).
- Drill into an extension: rating history, review timeline, complaint themes,
  and "I'd pay if…" style demand signals.

Tech notes:
- Next.js is the working assumption (canonical Vercel framework). Revisit if a
  lighter setup (static export + charting lib) is preferred.
- Use the Supabase JS client; read-only anon access for the public dashboard,
  service-role keys only in server-side code / never shipped to the browser.

_Not yet implemented — see the latest `Session log/` entry for status._
