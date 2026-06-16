import { getDashboardData } from "../lib/queries";

// Always render at request time so the build never needs Supabase credentials.
export const dynamic = "force-dynamic";

function fmt(n) {
  return n == null ? "—" : Number(n).toLocaleString();
}
function stars(r) {
  return r == null ? "—" : `${Number(r).toFixed(1)}★`;
}
function extLink(row) {
  const href = row.listing_url || (row.ext_id ? `https://chromewebstore.google.com/detail/x/${row.ext_id}` : null);
  return href ? <a href={href} target="_blank" rel="noreferrer">{row.name || row.ext_id}</a> : (row.name || row.ext_id);
}

function ExtTable({ rows, showCategory }) {
  if (!rows || rows.length === 0) return <p className="empty">No data yet.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Extension</th>
          {showCategory ? <th>Category</th> : null}
          <th className="num">Rating</th>
          <th className="num">Ratings</th>
          <th className="num">Installs</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ext_id}>
            <td>{extLink(r)}</td>
            {showCategory ? <td><span className="pill">{r.store_category || "—"}</span></td> : null}
            <td className="num">{stars(r.rating)}</td>
            <td className="num">{fmt(r.rating_count)}</td>
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
            <td>{r.extensions?.name || "—"}</td>
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
        <h1>ExtensionMiner</h1>
        <p>Chrome Web Store extensions worth building a competitor against — the ~3★ opportunity zone.</p>
      </header>

      {!d.configured && (
        <div className="banner">
          <strong>Supabase not connected.</strong> Set <code>SUPABASE_URL</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code> as environment variables (Vercel project
          settings, or <code>dashboard/.env.local</code> for local dev), then redeploy.
        </div>
      )}

      {d.configured && d.error && (
        <div className="banner">
          <strong>Connected, but a query failed:</strong> {d.error}
          <br />
          If this mentions a missing relation, apply{" "}
          <code>supabase/migrations/999_initial_schema.sql</code> to your project.
        </div>
      )}

      <div className="stats">
        <div className="stat"><div className="n">{fmt(d.counts.extensions)}</div><div className="l">extensions</div></div>
        <div className="stat"><div className="n">{fmt(d.counts.reviews)}</div><div className="l">reviews</div></div>
        <div className="stat"><div className="n">{fmt(d.opportunityZone.length)}</div><div className="l">in the opportunity zone</div></div>
      </div>

      <section className="zone">
        <h2>★ Opportunity zone (2.5–3.5★, by installs)</h2>
        <p className="sub">Real demand, unhappy users — the targets to overtake.</p>
        <ExtTable rows={d.opportunityZone} showCategory />
      </section>

      <section>
        <h2>Scored opportunities</h2>
        <p className="sub">Ranked by the Claude review-mining layer (Phase 3).</p>
        <OpportunityTable rows={d.opportunities} />
      </section>

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
