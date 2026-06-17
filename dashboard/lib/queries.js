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
  points: [],
};

// Helpful-flagged reviews (community-upvoted) — the strongest single signal:
// complaints people agree with. Lowest-star first so the gold surfaces on top.
const HELPFUL_REVIEW_COLS =
  "stars,author,body,reviewed_at,helpful_count,extensions(ext_id,name,store_category)";
const HELPFUL_LIMIT = 20;

// Lightweight columns for the charts; capped so a large catalog stays cheap.
const POINT_COLS = "ext_id,name,rating,rating_count,install_count,store_category";
const POINT_LIMIT = 1500;

const EXT_COLS = "ext_id,name,store_category,rating,rating_count,install_count,listing_url";

// The opportunity sweet spot: mid-rated with real demand.
const ZONE_MIN = 2.5;
const ZONE_MAX = 3.5;

export async function getDashboardData() {
  const supabase = getServerClient();
  if (!supabase) return EMPTY;

  try {
    const [zone, lowest, highest, opps, points, extCount, revCount, helpful] = await Promise.all([
      supabase
        .from("extensions")
        .select(EXT_COLS)
        .gte("rating", ZONE_MIN)
        .lte("rating", ZONE_MAX)
        .order("install_count", { ascending: false, nullsFirst: false })
        .limit(25),
      supabase
        .from("extensions")
        .select(EXT_COLS)
        .not("rating", "is", null)
        .order("rating", { ascending: true })
        .order("install_count", { ascending: false, nullsFirst: false })
        .limit(10),
      supabase
        .from("extensions")
        .select(EXT_COLS)
        .not("rating", "is", null)
        .order("rating", { ascending: false })
        .limit(10),
      supabase
        .from("opportunities")
        .select("score,top_complaint,complaint_type,fixable,brief,extensions(ext_id,name,rating,install_count,listing_url)")
        .order("score", { ascending: false, nullsFirst: false })
        .limit(25),
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
    ]);

    // Surface the first real error (e.g. schema not applied yet) without crashing.
    // `helpful` is intentionally excluded: it reads reviews.helpful_ranked, which
    // only exists once migration 996 is applied, so a missing column degrades to
    // an empty section instead of erroring the whole page.
    const firstError = [zone, lowest, highest, opps, points, extCount, revCount]
      .map((r) => r.error)
      .find(Boolean);

    return {
      configured: true,
      error: firstError ? firstError.message : null,
      counts: { extensions: extCount.count || 0, reviews: revCount.count || 0 },
      opportunityZone: zone.data || [],
      lowest: lowest.data || [],
      highest: highest.data || [],
      opportunities: opps.data || [],
      helpfulReviews: helpful.data || [],
      points: points.data || [],
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

// Fetch one extension (by its Chrome Web Store ext_id) plus the reviews we've
// saved for it, most recent first. Returns a small, page-ready shape.
export async function getExtensionReviews(extId) {
  const supabase = getServerClient();
  if (!supabase) {
    return { configured: false, error: null, notFound: false, extension: null, reviews: [] };
  }

  try {
    const { data: ext, error: extErr } = await supabase
      .from("extensions")
      .select(EXT_DETAIL_COLS)
      .eq("ext_id", extId)
      .maybeSingle();

    if (extErr) {
      return { configured: true, error: extErr.message, notFound: false, extension: null, reviews: [] };
    }
    if (!ext) {
      return { configured: true, error: null, notFound: true, extension: null, reviews: [] };
    }

    const { data: reviews, error: revErr } = await supabase
      .from("reviews")
      .select(REVIEW_COLS)
      .eq("extension_id", ext.id)
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .limit(REVIEW_LIMIT);

    return {
      configured: true,
      error: revErr ? revErr.message : null,
      notFound: false,
      extension: ext,
      reviews: reviews || [],
    };
  } catch (err) {
    return {
      configured: true,
      error: String(err && err.message ? err.message : err),
      notFound: false,
      extension: null,
      reviews: [],
    };
  }
}
