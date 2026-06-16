import { getServerClient, isConfigured } from "./supabase";

const EMPTY = {
  configured: isConfigured,
  error: null,
  counts: { extensions: 0, reviews: 0 },
  opportunityZone: [],
  lowest: [],
  highest: [],
  opportunities: [],
  points: [],
};

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
    const [zone, lowest, highest, opps, points, extCount, revCount] = await Promise.all([
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
        .select("score,top_complaint,complaint_type,fixable,brief,extensions(name,rating,install_count,listing_url)")
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
    ]);

    // Surface the first real error (e.g. schema not applied yet) without crashing.
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
      points: points.data || [],
    };
  } catch (err) {
    return { ...EMPTY, configured: true, error: String(err && err.message ? err.message : err) };
  }
}
