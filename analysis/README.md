# analysis/

Python data analysis, categorization, and opportunity scoring.

Responsibilities:
- Categorize extensions (store category + derived/clustered categories).
- Mine review text for unmet-demand signals ("I'd pay if…", "wish it could…",
  "almost perfect but…").
- Compute an **opportunity score** that surfaces mid-rated (~3-star),
  high-install extensions with recurring complaint themes — the targets worth
  building a competitor against.
- Feed derived tables (e.g. `opportunities`) back into Supabase for the
  dashboard to read.

_Not yet implemented — see the latest `Session log/` entry for status._
