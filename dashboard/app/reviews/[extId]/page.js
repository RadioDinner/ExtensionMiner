import { getExtensionReviews } from "../../../lib/queries";

// Render at request time so the build never needs Supabase credentials.
export const dynamic = "force-dynamic";

function fmt(n) {
  return n == null ? "—" : Number(n).toLocaleString();
}
function stars(r) {
  return r == null ? "—" : `${Number(r).toFixed(1)}★`;
}
function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}
function storeHref(ext) {
  if (!ext) return null;
  return ext.listing_url || (ext.ext_id ? `https://chromewebstore.google.com/detail/x/${ext.ext_id}` : null);
}

function StarRow({ n }) {
  const filled = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return (
    <span className="stars" title={`${n ?? "?"} of 5`}>
      {"★".repeat(filled)}
      <span className="off">{"★".repeat(5 - filled)}</span>
    </span>
  );
}

export default async function ReviewsPage({ params }) {
  const extId = params.extId;
  const d = await getExtensionReviews(extId);
  const ext = d.extension;
  const href = storeHref(ext);

  // Average across the reviews we actually saved (distinct from the store's
  // overall rating, which can be based on far more ratings than review texts).
  const withStars = d.reviews.filter((r) => r.stars != null);
  const savedAvg = withStars.length
    ? (withStars.reduce((a, r) => a + Number(r.stars), 0) / withStars.length).toFixed(1)
    : null;

  return (
    <main className="wrap">
      <p className="back"><a href="/">← Back to dashboard</a></p>

      <header>
        <span className="kicker">Saved reviews</span>
        <h1>{ext ? ext.name || ext.ext_id : "Extension"}</h1>
        {ext ? (
          <p className="meta">
            {ext.developer ? <>{ext.developer} · </> : null}
            {ext.store_category ? <span className="pill">{ext.store_category}</span> : null}
            {ext.store_category ? " · " : null}
            {stars(ext.rating)} ({fmt(ext.rating_count)} ratings) · {fmt(ext.install_count)} installs
          </p>
        ) : (
          <p className="meta">Reviews collected by the scraper, straight from your data.</p>
        )}
        {href ? (
          <p className="store-link">
            <a href={href} target="_blank" rel="noreferrer">View on Chrome Web Store ↗</a>
          </p>
        ) : null}
      </header>

      {!d.configured && (
        <div className="banner">
          <strong>Supabase not connected.</strong> Set <code>SUPABASE_URL</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code>, then redeploy.{" "}
          <strong><a href="/diagnostics">→ Run diagnostics</a></strong>
        </div>
      )}

      {d.configured && d.notFound && (
        <div className="banner">
          <strong>Extension not found.</strong> No extension with id{" "}
          <code>{extId}</code> is in your database yet — run the scraper, or head{" "}
          <a href="/">back to the dashboard</a>.
        </div>
      )}

      {d.configured && d.error && (
        <div className="banner">
          <strong>Query failed:</strong> {d.error}{" "}
          <strong><a href="/diagnostics">→ Run diagnostics</a></strong>
        </div>
      )}

      {d.configured && !d.notFound && !d.error && (
        <section>
          <h2>{fmt(d.reviews.length)} saved review{d.reviews.length === 1 ? "" : "s"}</h2>
          <p className="sub">
            Straight from your scraped data{savedAvg ? <> · avg <strong>{savedAvg}★</strong> across saved reviews</> : null}.
          </p>

          {d.reviews.length === 0 ? (
            <p className="empty">
              No reviews saved for this extension yet. Run the scraper to collect them.
            </p>
          ) : (
            <ul className="reviews">
              {d.reviews.map((rv, i) => (
                <li key={i} className="review">
                  <div className="review-head">
                    <StarRow n={rv.stars} />
                    <span className="author">{rv.author || "Anonymous"}</span>
                    <span className="date">{fmtDate(rv.reviewed_at)}</span>
                    {rv.helpful_count ? (
                      <span className="helpful">{fmt(rv.helpful_count)} found helpful</span>
                    ) : null}
                  </div>
                  <p className="review-body">
                    {rv.body ? rv.body : <em className="muted">(no review text)</em>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
