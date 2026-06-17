import { getDashboardData } from "../lib/queries";
import { RatingHistogram, OpportunityScatter } from "./charts";

// Always render at request time so the build never needs Supabase credentials.
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
// How many reviews/ratings we've actually saved for this extension, from the
// embedded `reviews(count)` aggregate (shape: reviews: [{ count: N }]).
function savedCount(row) {
  return row?.reviews?.[0]?.count ?? null;
}
function extLink(row) {
  const href = row.listing_url || (row.ext_id ? `https://chromewebstore.google.com/detail/x/${row.ext_id}` : null);
  return href ? <a href={href} target="_blank" rel="noreferrer">{row.name || row.ext_id}</a> : (row.name || row.ext_id);
}
// Internal link to the saved reviews we scraped for a given ext_id.
function reviewLinkFor(extId, label) {
  if (!extId) return label || "—";
  return <a href={`/reviews/${encodeURIComponent(extId)}`}>{label || extId}</a>;
}
function reviewLink(row) {
  return reviewLinkFor(row.ext_id, row.name || row.ext_id);
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

// Community-upvoted reviews (surfaced under the store's "Helpful" sort) — the
// complaints people agree with. Lowest-star first, each linking to that
// extension's saved reviews. Hidden entirely until there's data (so it stays
// quiet until migration 996 is applied and a Helpful-sort pass has run).
function HelpfulReviews({ rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <ul className="reviews">
      {rows.map((rv, i) => (
        <li key={i} className="review">
          <div className="review-head">
            <StarRow n={rv.stars} />
            <span className="author">{rv.author || "Anonymous"}</span>
            <span className="badge-helpful">👍 Helpful</span>
            <span className="ext-ref">
              {reviewLinkFor(rv.extensions?.ext_id, rv.extensions?.name)}
              {rv.extensions?.store_category ? <span className="pill">{rv.extensions.store_category}</span> : null}
            </span>
            <span className="date">{fmtDate(rv.reviewed_at)}</span>
          </div>
          <p className="review-body">
            {rv.body ? rv.body : <em className="muted">(no review text)</em>}
          </p>
        </li>
      ))}
    </ul>
  );
}

function ExtTable({ rows, showCategory, linkReviews }) {
  if (!rows || rows.length === 0) return <p className="empty">No data yet.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Extension</th>
          {showCategory ? <th>Category</th> : null}
          <th className="num">Rating</th>
          <th className="num" title="Total ratings on the Chrome Web Store">Ratings</th>
          <th className="num" title="Reviews/ratings saved in your own data">Saved</th>
          <th className="num">Installs</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ext_id}>
            <td>{linkReviews ? reviewLink(r) : extLink(r)}</td>
            {showCategory ? <td><span className="pill">{r.store_category || "—"}</span></td> : null}
            <td className="num">{stars(r.rating)}</td>
            <td className="num">{fmt(r.rating_count)}</td>
            <td className="num">{fmt(savedCount(r))}</td>
            <td className="num">{fmt(r.install_count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OpportunityTable({ rows }) {
  if (!rows || rows.length === 0) {
    return <p className="empty">No scored opportunities yet — run the Claude ranking layer after scraping.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th className="num">Score</th>
          <th>Extension</th>
          <th>Top fixable complaint</th>
          <th>Type</th>
          <th>Fixable</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="num">{r.score == null ? "—" : Number(r.score).toFixed(1)}</td>
            <td>{reviewLinkFor(r.extensions?.ext_id, r.extensions?.name)}</td>
            <td>{r.top_complaint || "—"}</td>
            <td><span className="pill">{r.complaint_type || "—"}</span></td>
            <td>{r.fixable || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function Page() {
  const d = await getDashboardData();

  return (
    <main className="wrap">
      <header>
        <span className="kicker">Chrome Web Store · opportunity miner</span>
        <h1>ExtensionMiner</h1>
        <p>Extensions worth building a competitor against — the ~3★ opportunity zone.</p>
      </header>

      {!d.configured && (
        <div className="banner">
          <strong>Supabase not connected.</strong> Set <code>SUPABASE_URL</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code> as environment variables (Vercel project
          settings, or <code>dashboard/.env.local</code> for local dev), then redeploy.{" "}
          <strong><a href="/diagnostics">→ Run diagnostics</a></strong>
        </div>
      )}

      {d.configured && d.error && (
        <div className="banner">
          <strong>Connected, but a query failed:</strong> {d.error}
          <br />
          If this mentions a missing relation, apply{" "}
          <code>supabase/migrations/999_initial_schema.sql</code> to your project.{" "}
          <strong><a href="/diagnostics">→ Run diagnostics</a></strong>
        </div>
      )}

      {d.configured && !d.error && d.counts.extensions === 0 && (
        <div className="banner">
          <strong>Connected, no errors — but 0 rows.</strong> If you know the tables have
          data, it's almost always one of two things:{" "}
          <strong>(1)</strong> <code>SUPABASE_SERVICE_ROLE_KEY</code> is set to the{" "}
          <em>anon / publishable</em> key instead of the <em>service_role</em> secret — RLS
          is enabled with no policies, so the wrong key returns nothing with no error; or{" "}
          <strong>(2)</strong> <code>SUPABASE_URL</code> points at a different project than
          the scraper writes to. Fix the value in your host and redeploy.{" "}
          <strong><a href="/diagnostics">→ Run diagnostics</a></strong> to see which.
        </div>
      )}

      {(!d.configured || d.error || d.counts.extensions === 0) ? null : (
        <p className="diag-link"><a href="/diagnostics">Connection diagnostics →</a></p>
      )}

      <div className="stats">
        <div className="stat"><div className="n">{fmt(d.counts.extensions)}</div><div className="l">extensions</div></div>
        <div className="stat"><div className="n">{fmt(d.counts.reviews)}</div><div className="l">reviews</div></div>
        <div className="stat zone"><div className="n">{fmt(d.opportunityZone.length)}</div><div className="l">in the opportunity zone</div></div>
      </div>

      <section className="charts-section">
        <div className="charts">
          <div className="card">
            <h3>Rating distribution</h3>
            <p className="sub">Where the catalog sits. Gold bars are the 2.5–3.5★ zone.</p>
            <div className="chart"><RatingHistogram points={d.points} /></div>
          </div>
          <div className="card">
            <h3>Rating vs. installs</h3>
            <p className="sub">Demand (installs, log) against satisfaction (rating). Gold dots in the shaded band are the targets.</p>
            <div className="chart"><OpportunityScatter points={d.points} /></div>
          </div>
        </div>
        <div className="legend">
          <span><span className="dot gold" /> Opportunity zone (2.5–3.5★)</span>
          <span><span className="dot accent" /> Everything else</span>
          <span className="legend-note">Dot size ∝ number of ratings · hover for details</span>
        </div>
      </section>

      <section className="zone">
        <h2>★ Opportunity zone (2.5–3.5★, by installs)</h2>
        <p className="sub">Real demand, unhappy users — the targets to overtake. Click a name to read its saved reviews.</p>
        <ExtTable rows={d.opportunityZone} showCategory linkReviews />
      </section>

      <section>
        <h2>Scored opportunities</h2>
        <p className="sub">Ranked by the Claude review-mining layer (Phase 3). Click a name to read its saved reviews.</p>
        <OpportunityTable rows={d.opportunities} />
      </section>

      {d.helpfulReviews && d.helpfulReviews.length > 0 && (
        <section>
          <h2>👍 Community-upvoted reviews</h2>
          <p className="sub">Reviews the store flagged as <em>Helpful</em> — complaints people agree with, lowest-rated first. Click an extension to see all its saved reviews.</p>
          <HelpfulReviews rows={d.helpfulReviews} />
        </section>
      )}

      <section>
        <h2>Lowest rated (high installs first)</h2>
        <ExtTable rows={d.lowest} />
      </section>

      <section>
        <h2>Highest rated</h2>
        <ExtTable rows={d.highest} />
      </section>
    </main>
  );
}
