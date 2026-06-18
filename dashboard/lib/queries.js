import { getServerClient, isConfigured } from "./supabase";

const EMPTY = {
  configured: isConfigured,
  error: null,
  counts: { extensions: 0, reviews: 0 },
  opportunityZone: [],
  lowest: [],
  highest: [],
  opportunities: [],
  helpfulReviews: [],
  monetization: {},
  deepDiveStatus: {},
  points: [],
  rankingForceRerun: false,
  dismissedZone: [],
};

// How many zone candidates to pull so the curated top-25 can backfill past any
// the user has dismissed.
const ZONE_FETCH = 200;
const ZONE_SHOW = 25;

// Monetization columns we surface in the tables (keyed by ext_id below).
const MONETIZATION_COLS =
  "pricing_model,makes_money,has_paid_tier,estimated_monthly_revenue_usd,revenue_low_usd,revenue_high_usd,confidence,monetization_summary,extensions(ext_id)";

// Helpful-flagged reviews (community-upvoted) — the strongest single signal:
// complaints people agree with. Lowest-star first so the gold surfaces on top.
const HELPFUL_REVIEW_COLS =
  "stars,author,body,reviewed_at,helpful_count,extensions(ext_id,name,store_category)";
const HELPFUL_LIMIT = 20;

// Lightweight columns for the charts; capped so a large catalog stays cheap.
const POINT_COLS = "ext_id,name,rating,rating_count,install_count,store_category";
const POINT_LIMIT = 1500;

const EXT_COLS = "ext_id,name,developer,store_category,rating,rating_count,install_count,listing_url";
// Same columns, plus the count of reviews/ratings WE'VE saved for each extension.
// `reviews(count)` is a PostgREST embedded aggregate — it rides along in the one
// query (no migration, no N+1) and comes back as `reviews: [{ count: N }]`.
const EXT_SELECT = `${EXT_COLS},reviews(count)`;

// The opportunity sweet spot: mid-rated with real demand.
const ZONE_MIN = 2.5;
const ZONE_MAX = 3.5;

export async function getDashboardData() {
  const supabase = getServerClient();
  if (!supabase) return EMPTY;

  try {
    const [zone, lowest, highest, opps, points, extCount, revCount, helpful, money, deepDives, settings, excl, legit] = await Promise.all([
      supabase
        .from("extensions")
        .select(EXT_SELECT)
        .gte("rating", ZONE_MIN)
        .lte("rating", ZONE_MAX)
        .order("install_count", { ascending: false, nullsFirst: false })
        .limit(ZONE_FETCH),
      supabase
        .from("extensions")
        .select(EXT_SELECT)
        .not("rating", "is", null)
        .order("rating", { ascending: true })
        .order("install_count", { ascending: false, nullsFirst: false })
        .limit(10),
      supabase
        .from("extensions")
        .select(EXT_SELECT)
        .not("rating", "is", null)
        .order("rating", { ascending: false })
        .limit(10),
      supabase
        .from("opportunities")
        .select("score,top_complaint,complaint_type,fixable,recency_weight,decline_score,recent_rating,baseline_rating,complaint_trend,brief,extensions(ext_id,name,rating,install_count,listing_url)")
        .order("score", { ascending: false, nullsFirst: false })
        .limit(200),
      supabase
        .from("extensions")
        .select(POINT_COLS)
        .not("rating", "is", null)
        .order("install_count", { ascending: false, nullsFirst: false })
        .limit(POINT_LIMIT),
      supabase.from("extensions").select("*", { count: "exact", head: true }),
      supabase.from("reviews").select("*", { count: "exact", head: true }),
      supabase
        .from("reviews")
        .select(HELPFUL_REVIEW_COLS)
        .eq("helpful_ranked", true)
        .order("stars", { ascending: true, nullsFirst: false })
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .limit(HELPFUL_LIMIT),
      supabase
        .from("monetization")
        .select(MONETIZATION_COLS)
        .order("estimated_monthly_revenue_usd", { ascending: false, nullsFirst: false })
        .limit(2000),
      supabase
        .from("deep_dives")
        .select("status,extensions(ext_id)")
        .limit(2000),
      supabase
        .from("app_settings")
        .select("value")
        .eq("key", "ranking_force_rerun")
        .limit(1),
      supabase
        .from("zone_exclusions")
        .select("reason,dismissed_at,extensions(ext_id,name,store_category,rating,install_count,listing_url)")
        .order("dismissed_at", { ascending: false })
        .limit(2000),
      supabase
        .from("review_analysis")
        .select("legitimacy,primary_cause,verdict,extensions(ext_id)")
        .limit(5000),
    ]);

    // Surface the first real error (e.g. schema not applied yet) without crashing.
    // `helpful`, `money`, `deepDives`, `settings`, `excl` and `legit` are
    // intentionally excluded: they read columns/tables (reviews.helpful_ranked,
    // monetization, deep_dives, app_settings, zone_exclusions, review_analysis)
    // that only exist once migrations 996 / 995 / 993 / 991 / 990 / 988 are
    // applied, so a missing one degrades to an empty section / default instead of
    // erroring the whole page.
    const firstError = [zone, lowest, highest, opps, points, extCount, revCount]
      .map((r) => r.error)
      .find(Boolean);

    // ext_id -> monetization profile, for cheap lookups in the tables.
    const monetization = {};
    for (const m of money.data || []) {
      const extId = m.extensions?.ext_id;
      if (extId) monetization[extId] = m;
    }

    // ext_id -> deep-dive status ('queued' | 'done' | 'error'); absent = 'none'.
    const deepDiveStatus = {};
    for (const d of deepDives.data || []) {
      const extId = d.extensions?.ext_id;
      if (extId) deepDiveStatus[extId] = d.status;
    }

    // The ranking-layer override toggle (default OFF when 991 isn't applied).
    const rankingForceRerun = Boolean(settings.data?.[0]?.value);

    // Extensions the user dismissed from the zone (resilient to 990 absent).
    const dismissedZone = (excl.data || [])
      .filter((e) => e.extensions)
      .map((e) => ({
        ext_id: e.extensions.ext_id,
        name: e.extensions.name,
        store_category: e.extensions.store_category,
        rating: e.extensions.rating,
        install_count: e.extensions.install_count,
        listing_url: e.extensions.listing_url,
        reason: e.reason,
        dismissed_at: e.dismissed_at,
      }));
    const dismissedSet = new Set(dismissedZone.map((d) => d.ext_id));

    // ext_id -> Layer 0 review-legitimacy (migration 988; absent = unscreened).
    const reviewLegit = {};
    for (const r of legit.data || []) {
      const extId = r.extensions?.ext_id;
      if (extId) reviewLegit[extId] = r;
    }

    // Curated zone: drop dismissed, attach Layer 0, then re-rank by installs
    // DEMOTED by review legitimacy — so an extension that's only 3★ because it was
    // review-bombed sinks below one with the same installs but real complaints.
    // Unscreened extensions (no Layer 0 yet) keep a neutral multiplier of 1.
    const opportunityZone = (zone.data || [])
      .filter((r) => !dismissedSet.has(r.ext_id))
      .map((r) => {
        const la = reviewLegit[r.ext_id] || null;
        const legitimacy = la && la.legitimacy != null ? Number(la.legitimacy) : null;
        return {
          ...r,
          legitimacy,
          review_cause: la ? la.primary_cause : null,
          review_verdict: la ? la.verdict : null,
        };
      })
      .sort((a, b) => {
        const ka = (a.install_count || 0) * (a.legitimacy == null ? 1 : a.legitimacy);
        const kb = (b.install_count || 0) * (b.legitimacy == null ? 1 : b.legitimacy);
        return kb - ka;
      })
      .slice(0, ZONE_SHOW);

    return {
      configured: true,
      error: firstError ? firstError.message : null,
      counts: { extensions: extCount.count || 0, reviews: revCount.count || 0 },
      opportunityZone,
      lowest: lowest.data || [],
      highest: highest.data || [],
      opportunities: opps.data || [],
      helpfulReviews: helpful.data || [],
      monetization,
      deepDiveStatus,
      points: points.data || [],
      rankingForceRerun,
      dismissedZone,
    };
  } catch (err) {
    return { ...EMPTY, configured: true, error: String(err && err.message ? err.message : err) };
  }
}

// --- Per-extension saved reviews (the /reviews/[extId] page) -----------------

const EXT_DETAIL_COLS =
  "id,ext_id,name,developer,store_category,rating,rating_count,install_count,listing_url";
const REVIEW_COLS = "stars,author,body,reviewed_at,helpful_count,language,helpful_ranked";
const REVIEW_LIMIT = 1000;

// The ranker's output for this extension: score + the structured analysis
// (clusters + "what it does"), used for the detail page's digest.
const OPP_DETAIL_COLS =
  "score,top_complaint,complaint_type,fixable,recency_weight,decline_score,recent_rating,baseline_rating,complaint_trend,brief,build_effort,details";
// The subset guaranteed by the initial schema (migration 999). Used as a
// fallback so a newer column that isn't queryable yet (migration not applied, or
// PostgREST's schema cache still stale right after one) can't drop the whole
// digest — we lose only the Recency/Trend extras, not the summary.
const OPP_CORE_COLS = "score,top_complaint,complaint_type,fixable,brief,build_effort,details";
// Full monetization profile (every field) for the profitability breakdown.
const MON_DETAIL_COLS =
  "pricing_model,makes_money,has_paid_tier,price_min_usd,price_max_usd,estimated_users," +
  "estimated_monthly_revenue_usd,revenue_low_usd,revenue_high_usd,confidence," +
  "monetization_summary,pricing_notes,sources";
// The deep-dive pool entry + its results (migration 993).
const DEEP_DIVE_COLS =
  "status,what_it_is,review_summary,competitors,opportunity,recommendation,sources,error,analyzed_at,requested_at";
// Layer 0 review-legitimacy analysis (migration 988).
const L0_COLS =
  "status,legitimacy,primary_cause,verdict,summary,categories,sentiment_note,reviews_analyzed,analyzed_at,error";
// Layer 2/3 deep-dive studies (migration 989). One row per (extension, layer).
const STUDY_COLS =
  "layer,status,prompt,report_md,summary,recommendation,target_strengths,target_weaknesses," +
  "competitors,opportunities,financials,sources,uploaded_at,source_filename,parse_warning,model,requested_at,error";

// All study rows (layers 2 & 3) for one extension, keyed by layer. Resilient to
// the table not existing yet (migration 989 not applied) — returns {}.
async function maybeStudies(supabase, extensionId) {
  try {
    const { data, error } = await supabase
      .from("deep_dive_studies")
      .select(STUDY_COLS)
      .eq("extension_id", extensionId);
    if (error) return {};
    const map = {};
    for (const r of data || []) map[r.layer] = r;
    return map;
  } catch {
    return {};
  }
}

// One row by extension_id, tolerating a missing table/column (e.g. the
// opportunities/monetization migration not applied yet) by returning null
// instead of throwing — the detail page just hides that section. If the full
// select errors and `fallbackCols` is given, retry with those: a single
// unknown/uncached column then costs only those fields, not the whole row.
async function maybeRowByExtension(supabase, table, cols, extensionId, fallbackCols) {
  const fetchWith = (select) =>
    supabase.from(table).select(select).eq("extension_id", extensionId).maybeSingle();
  try {
    const { data, error } = await fetchWith(cols);
    if (!error) return data;
    if (fallbackCols) {
      const r = await fetchWith(fallbackCols);
      return r.error ? null : r.data;
    }
    return null;
  } catch {
    if (fallbackCols) {
      try {
        const r = await fetchWith(fallbackCols);
        return r.error ? null : r.data;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Fetch one extension (by its Chrome Web Store ext_id) plus the reviews we've
// saved for it (most recent first), the ranker's analysis, and the monetization
// profile. Returns a small, page-ready shape.
export async function getExtensionReviews(extId) {
  const supabase = getServerClient();
  if (!supabase) {
    return { configured: false, error: null, notFound: false, extension: null, reviews: [], opportunity: null, monetization: null };
  }

  try {
    const { data: ext, error: extErr } = await supabase
      .from("extensions")
      .select(EXT_DETAIL_COLS)
      .eq("ext_id", extId)
      .maybeSingle();

    if (extErr) {
      return { configured: true, error: extErr.message, notFound: false, extension: null, reviews: [], opportunity: null, monetization: null };
    }
    if (!ext) {
      return { configured: true, error: null, notFound: true, extension: null, reviews: [], opportunity: null, monetization: null };
    }

    const [reviewsRes, opportunity, monetization, deepDive, layer0, studies] = await Promise.all([
      supabase
        .from("reviews")
        .select(REVIEW_COLS)
        .eq("extension_id", ext.id)
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .limit(REVIEW_LIMIT),
      maybeRowByExtension(supabase, "opportunities", OPP_DETAIL_COLS, ext.id, OPP_CORE_COLS),
      maybeRowByExtension(supabase, "monetization", MON_DETAIL_COLS, ext.id),
      maybeRowByExtension(supabase, "deep_dives", DEEP_DIVE_COLS, ext.id),
      maybeRowByExtension(supabase, "review_analysis", L0_COLS, ext.id),
      maybeStudies(supabase, ext.id),
    ]);

    return {
      configured: true,
      error: reviewsRes.error ? reviewsRes.error.message : null,
      notFound: false,
      extension: ext,
      reviews: reviewsRes.data || [],
      opportunity,
      monetization,
      deepDive,
      layer0,
      studies,
    };
  } catch (err) {
    return {
      configured: true,
      error: String(err && err.message ? err.message : err),
      notFound: false,
      extension: null,
      reviews: [],
      opportunity: null,
      monetization: null,
      deepDive: null,
      layer0: null,
      studies: {},
    };
  }
}
