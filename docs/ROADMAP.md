# Roadmap: Chrome Web Store Review-Miner → Claude Idea-Ranker

**Goal:** an internal research tool that mines *public* Chrome Web Store reviews and uses Claude to rank extensions where people complain about a **fixable** problem and signal they'd **use or pay if it were fixed** ("love the idea, hate the execution"). Output: a ranked shortlist of fix-and-flip extension targets, each backed by real review evidence.

> **READ THIS FIRST.** This tool is *research infrastructure, not the product.* The product you sell is the fixed extension you build afterward. The miner exists only to pick that one target. Hard time-box: **≤ ~20 hours / 5–6 of your weekends.** If it's taking longer, you're over-building it. The only success condition for this entire roadmap is **"picked one validated target to build."**

---

## Architecture decision (settle this before writing code)

- **No official Chrome Web Store reviews API exists.** Reviews are publicly visible logged-out, which puts you on the *defensible* side of the scraping line we covered (the "can I see it in an incognito window" test). Still: respect Google's ToS/robots, rate-limit, cache, and **never republish raw scraped reviews as a public-facing product** — internal decision-support use is the low-risk lane; reselling the data is not.
- **Two ways to get the data:**
  - **RECOMMENDED — rent it (managed scraper).** Apify has off-the-shelf actors that pull reviews + ratings + install counts + metadata, handle proxy rotation / anti-bot / pagination for you, and return JSON/CSV via API. Pricing is usage-based (check current rates — cheap at your scale of a few categories). This offloads the fragile arms-race maintenance and frees your hours for the ranking layer.
    - https://apify.com/neatrat/chrome-webstore-extension-reviews-scraper
    - https://apify.com/getdataforme/chrome-extension-review-scraper
    - (No-code alternative: https://www.browse.ai/t/scrape-extension-review-chrome-web-store)
  - **FALLBACK — build it (DIY).** Playwright or Selenium + Python, run politely (incognito context, rate limits, caching, retries, respect robots.txt). Documented and doable, but you'll be fighting Google's anti-scraping yourself = more maintenance. Reference: https://www.specrom.com/blog/using-selenium-and-python-to-web-scrape-google-chrome-web-store-extensions-reviews/

---

## PHASE 0 — Scope & decide (≤ 2 hrs)
- [ ] Write the one-sentence output spec (e.g., "a ranked CSV of extensions in categories X/Y with a recurring fixable complaint and ≥3 reviewers who'd switch if fixed").
- [ ] Pick **1–3 starting categories you understand** — don't boil the ocean. Sensible given your skills: Developer Tools, Productivity, data/scraping tools, e-commerce ops.
- [ ] Decide data source: **managed scraper (recommended)** vs. DIY.
- [ ] Set the hard time-box (≤ ~20 hrs total for the miner) and write it at the top of your repo.
- [ ] Get a Claude **API key** (Anthropic Console) for the ranking layer. Note: this is separate from Claude Code — Claude Code *builds the tool*; the API *runs the analysis inside it*.

## PHASE 1 — Claude Code project setup (≤ 3 hrs)
- [ ] New git repo. Add a **CLAUDE.md** describing the project, the data schema, your constraints, and the time-box — so Claude Code has full context every session.
- [ ] Choose stack: **Python**. Even though C# is your home turf, the scraping/data/AI-glue libraries (requests, pandas, the Apify and Anthropic SDKs) and examples are far denser in Python, and Claude Code writes it for you — your SQL/C# logic transfers directly. (If you'd rather stay in C#, fine; Claude Code handles both.)
- [ ] Define the data schema: `extension_id, name, category, install_count, overall_rating, review_id, review_rating, review_text, review_date`.
- [ ] Pick storage: **SQLite** (your SQL comfort zone — lets you query/slice) or CSV/Parquet. SQLite recommended.

## PHASE 2 — Data-collection layer (≤ 6 hrs)
- [ ] **If managed (Apify):** wire the API → list extensions in your target categories → pull their reviews → land in SQLite. **Cache raw responses** so you never re-fetch and never re-pay.
- [ ] **If DIY:** have Claude Code build a Playwright scraper; add rate limiting (a few seconds between requests), retries, caching, an incognito context; respect robots.txt; run slowly / off-hours.
- [ ] Capture at minimum: **install count + overall rating** (to size the market) and the **full review set or a large sample**, weighted toward 1–3 star and recent reviews (that's where fixable complaints live).
- [ ] Sanity-check: dump a few extensions' reviews and eyeball that the data is clean, complete, and not truncated.

## PHASE 3 — Analysis & ranking layer (the valuable part) (≤ 6 hrs)
This is where Claude + your data skills create the edge. Build it, don't gold-plate it.

- [ ] For each extension, send its reviews to the Claude API with a structured prompt that returns JSON per review-cluster:
  - the specific recurring complaint(s)
  - is it plausibly **fixable by a third-party / replacement extension**? (yes/no/maybe)
  - any explicit **"would use / would pay / would switch if fixed"** signals — *quote them verbatim*
  - complaint type: **missing feature / bug / pricing / abandonment**
- [ ] Aggregate per extension into a score. Starting rubric (tune the weights against reality):
  - **Demand intensity** — # of *independent* reviewers raising the same fixable complaint *(heaviest weight)*
  - **Willingness-to-pay signals** present (explicit "I'd pay / I'd switch")
  - **Fixability** by a small solo build (high = good)
  - **Gap persistence** — the same complaint goes unaddressed across the top competitors in the category
  - **Market size** — incumbent install count (proxy for addressable demand)
  - **Buildability for you** — a v1 in ≤ ~20–40 of your hours
  - **Penalties:** "the whole thing is just bad," abandoned-with-no-salvageable-demand, or fixes that need a backend/AI cost you don't want to maintain
- [ ] Output a ranked table: `extension, category, installs, rating, top fixable complaint, WTP evidence (quotes), score, your build-effort guess`.
- [ ] Have Claude write a one-paragraph **opportunity brief** for the top ~10.

## PHASE 4 — Human validation (don't trust the model blind) (≤ 3 hrs)
- [ ] For the top candidates, apply the **GO/NO-GO bar** from your build roadmap: ≥3 independent people with the same pain; an explicit WTP signal **OR** a paid incumbent with mineable negative reviews; buildable in ≤ ~20–40 of your hours; a reachable self-serve channel; **extra skepticism if there's no incumbent at all** (often means unmonetizable, not untapped).
- [ ] Manually **read the actual reviews and install the incumbent extension** to confirm the complaint is real, current, and not already quietly fixed. (Reviews skew negative, skew to power users, and go stale — the model will miss this.)
- [ ] **Pick ONE.** Stop. This is the finish line for this project.

## PHASE 5 — Hand off to build & ship (your existing roadmap takes over)
- [ ] Scope the minimal *fixed-version* v1; build it with Claude Code.
- [ ] Wire **ExtPay** (fast, no backend) or a **Merchant-of-Record** (Paddle / Lemon Squeezy) if you want zero tax/VAT admin.
- [ ] Write the privacy policy + Chrome Web Store privacy-practices form + ASO listing (title/keywords/screenshots). Ship to Chrome **and** Edge.
- [ ] **In parallel:** list one Gumroad spreadsheet template from your domain to bank a literal first dollar while the extension sits in review.

---

## Cautions (each stated once)
- The miner is infrastructure. Time-box it; ship the *decision*, not the tool.
- A handful of complaints ≠ demand. The GO/NO-GO bar exists to catch sampling bias.
- The signal is "love the idea, hate the execution." "It's just bad" and "abandoned, nobody cares" are not signals.
- Keep scraped reviews **internal**. Republishing them as a product re-opens the ToS/IP risk you just decided to avoid.

## Accuracy ratings
- Data-access reality (no official API; reviews are public; managed scrapers handle collection): **90**
- Architecture recommendation (rent the scraper, build the ranker): **85** — judgment call; flips toward DIY only if you object to per-use cost or want full control.
- The scoring rubric as a *good predictor*: **70** — it's a sound starting point but needs tuning against real outcomes; no rubric is right out of the box.
- Time estimates at 4 hrs/week: **70** — soft by nature; DIY scraper debugging is the most likely thing to blow the budget (another reason to rent it).

---

## How this repo implements the roadmap (Session 2 decisions)

This is the canonical strategy doc. A few decisions diverge from the defaults above — recorded here so they don't get re-litigated:

- **Scope:** "Lean now, product foundation." Start with **1–3 categories** and the single goal of **picking ONE target**, but build on a **Supabase + Next.js** foundation so it can scale toward the full-catalog vision later.
- **Data source:** **DIY Python scraper** (Playwright), run politely. (Apify was offered as the lower-effort path; the user chose self-contained / no per-use cost.)
- **Storage:** **Supabase (Postgres)**, not SQLite — chosen so the eventual Vercel dashboard reads from it directly. Migrations live in `supabase/migrations/` and are numbered DOWN from 999.
- **Ranking layer:** **Claude API (Anthropic)** — the valuable part. Reachable from the web env, so it can be developed/tested here.
- **Environment note:** the Chrome Web Store is egress-blocked in the Claude-Code-on-the-web environment (HTTP 403), so the scraper must **run locally** (or in an env with a wider network policy). The ranking layer and schema work fine in the web env.
