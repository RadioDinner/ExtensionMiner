// Canonical scraper settings the "Scraper settings" tab controls. Mirrors
// scraper/run.py DEFAULT_SCRAPER_SETTINGS — keep the two in sync. Stored as the
// app_settings.scraper_settings JSON blob; the Python scraper reads it when run
// with --use-saved-settings.
export const DEFAULT_SCRAPER_SETTINGS = {
  categories: [], // [] -> the scraper's env TARGET_CATEGORIES
  all_categories: false,
  max_extensions: 25,
  category_scrolls: 40,
  discovery_patience: 3,
  review_scrolls: 6,
  multi_sort: true,
  load_more_max: 40,
  follow_related: false,
  max_total: 0,
  concurrency: 1,
  refresh: false,
  skip_existing: false,
  refresh_after_days: null, // null = re-scrape regardless of age
  rate_limit_seconds: null, // null = scraper's env/default (3s)
  reviews_zone_only: false,
  zone_min: 2.5,
  zone_max: 3.5,
};

// Field metadata drives both the form UI and server-side coercion, so the two
// can never drift. `type`: bool | int | float | intNull | floatNull | csv.
export const SCRAPER_FIELDS = [
  { key: "reviews_zone_only", type: "bool", label: "Only save reviews for in-zone extensions",
    help: "Skip the (slow) review fetch for extensions whose overall rating is outside the zone below. Their metadata is still saved." },
  { key: "zone_min", type: "float", label: "Zone min rating", help: "Lower bound of the opportunity zone (stars)." },
  { key: "zone_max", type: "float", label: "Zone max rating", help: "Upper bound of the opportunity zone (stars)." },
  { key: "categories", type: "csv", label: "Categories", help: "Comma-separated category slugs (e.g. productivity/tools, lifestyle/shopping). Leave blank to use the scraper's configured default categories." },
  { key: "all_categories", type: "bool", label: "Crawl ALL categories", help: "Discover and crawl the whole store taxonomy (ignores the Categories list above). Big run." },
  { key: "max_extensions", type: "int", label: "Max extensions / category", help: "0 = no cap. The interactive default is 25." },
  { key: "max_total", type: "int", label: "Max extensions total", help: "Stop after discovering this many overall. 0 = no cap." },
  { key: "concurrency", type: "int", label: "Concurrency (workers)", help: "Parallel browser workers. They share one polite rate limiter, so this speeds the crawl without raising the request rate." },
  { key: "rate_limit_seconds", type: "floatNull", label: "Rate limit (seconds)", help: "Seconds between page requests. Blank = the scraper's env/default (3s). Lower = faster but less polite." },
  { key: "follow_related", type: "bool", label: "Follow related links", help: "Graph-crawl: also enqueue each extension's 'related' links — reaches far more than category pages alone." },
  { key: "refresh", type: "bool", label: "Refresh (bypass cache)", help: "Ignore the on-disk HTML cache and re-fetch pages, so new reviews/ratings are seen." },
  { key: "skip_existing", type: "bool", label: "Skip existing", help: "Skip extensions already stored in the DB (faster resume)." },
  { key: "refresh_after_days", type: "intNull", label: "Refresh after N days", help: "Re-scrape rows older than N days, skip fresher ones. Blank = off." },
  { key: "review_scrolls", type: "int", label: "Review scrolls", help: "Lazy-load scroll passes on a reviews page." },
  { key: "load_more_max", type: "int", label: "'Load more' clicks max", help: "Max 'Load more' clicks per review sort. 0 disables." },
  { key: "multi_sort", type: "bool", label: "Multi-sort reviews", help: "Scrape both Recent and Helpful sorts to gather past the store's ~10-per-sort cap." },
  { key: "category_scrolls", type: "int", label: "Category scrolls", help: "Max scroll passes to exhaust a category's extension list." },
  { key: "discovery_patience", type: "int", label: "Discovery patience", help: "Stop scrolling a category after this many passes surface no new extensions." },
];

// Coerce a raw input object into a clean settings object with correct types,
// filling any missing field from the defaults. Used by the save action so we
// never persist junk, and by the form to normalize initial values.
export function coerceScraperSettings(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const f of SCRAPER_FIELDS) {
    const raw = src[f.key];
    const dflt = DEFAULT_SCRAPER_SETTINGS[f.key];
    switch (f.type) {
      case "bool":
        out[f.key] = raw == null ? dflt : Boolean(raw);
        break;
      case "int": {
        const n = parseInt(raw, 10);
        out[f.key] = Number.isFinite(n) ? n : dflt;
        break;
      }
      case "float": {
        const n = parseFloat(raw);
        out[f.key] = Number.isFinite(n) ? n : dflt;
        break;
      }
      case "intNull": {
        if (raw == null || raw === "") { out[f.key] = null; break; }
        const n = parseInt(raw, 10);
        out[f.key] = Number.isFinite(n) ? n : null;
        break;
      }
      case "floatNull": {
        if (raw == null || raw === "") { out[f.key] = null; break; }
        const n = parseFloat(raw);
        out[f.key] = Number.isFinite(n) ? n : null;
        break;
      }
      case "csv":
        if (Array.isArray(raw)) out[f.key] = raw.map((s) => String(s).trim()).filter(Boolean);
        else if (typeof raw === "string") out[f.key] = raw.split(",").map((s) => s.trim()).filter(Boolean);
        else out[f.key] = dflt;
        break;
      default:
        out[f.key] = raw ?? dflt;
    }
  }
  return out;
}
