import { getExtensionReviews } from "../../../lib/queries";
import DeepDiveButton from "./DeepDiveButton";
import StudyLayer from "./StudyLayer";
import StudyReport from "./StudyReport";
import ReviewList from "../../ReviewList";
import CompetitorGraph from "../../CompetitorGraph";
import { buildStudyPrompt } from "../../../lib/layerPrompts";
import { LAYER_META } from "../../../lib/layers";

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
function usd(n) {
  return n == null ? "—" : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function range(lo, hi) {
  if (lo == null && hi == null) return "—";
  return `${usd(lo)} – ${usd(hi)}`;
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
  // Reviews the community upvoted (surfaced under the store's "Helpful" sort) —
  // a lead on the complaints people agree with.
  const helpfulCount = d.reviews.filter((r) => r.helpful_ranked).length;

  // The ranker's digest for this extension (present once the Claude layer ran).
  const opp = d.opportunity;
  const details = (opp && opp.details) || {};
  const whatItDoes = details.what_it_does || (opp && opp.brief) || null;
  const clusters = Array.isArray(details.clusters) ? details.clusters : [];
  const mon = d.monetization;
  // Is the extension getting worse? (decline signal from the ranker)
  const declining = opp && opp.decline_score != null && opp.decline_score >= 0.2;
  const declineTitle = declining
    ? `Recent ${opp.recent_rating ?? "?"}★ vs baseline ${opp.baseline_rating ?? "?"}★` +
      (opp.complaint_trend ? ` · complaints +${Math.round(opp.complaint_trend * 100)}%` : "")
    : "";

  // Deep-dive pool entry + (once run) its comprehensive research.
  const dd = d.deepDive;
  const ddStatus = dd && dd.status;
  const competitors = dd && Array.isArray(dd.competitors) ? dd.competitors : [];

  // Layered deep-dive: Layer 0 (auto review legitimacy), Layer 1 (dd above),
  // Layers 2/3 (skill-driven studies, gated in order).
  const layer0 = d.layer0 && d.layer0.status === "done" ? d.layer0 : null;
  const studies = d.studies || {};
  const study2 = studies[2] || null;
  const study3 = studies[3] || null;
  const l1Done = ddStatus === "done";
  const l2Done = Boolean(study2 && study2.status === "done");
  const l3Done = Boolean(study3 && study3.status === "done");
  const extName = ext ? ext.name || ext.ext_id : "This extension";
  const l2Prompt = ext ? buildStudyPrompt(ext, 2) : "";
  const l3Prompt = ext ? buildStudyPrompt(ext, 3) : "";
  const l0Legit = layer0 && layer0.legitimacy != null ? Number(layer0.legitimacy) : null;

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

      {d.configured && dd && dd.status === "error" && (
        <div className="banner">
          <strong>Deep dive failed:</strong> {dd.error || "unknown error"}. Use{" "}
          <strong>“Re-run deep dive”</strong> in Layer 1 below to try again.
        </div>
      )}

      {d.configured && !d.notFound && !d.error && ext && (
        <section className="layers-panel">
          <h2>🧠 Deep-dive layers</h2>
          <p className="sub">
            A layered research stack — Layer 0 is automatic; Layers 1 → 3 go deeper and run in order.
          </p>

          {/* Layer 0 — automatic review-legitimacy pre-screen */}
          <div className="study-layer layer0">
            <div className="study-layer-head">
              <span className="study-icon">{LAYER_META[0].icon}</span>
              <span className="study-name"><strong>{LAYER_META[0].short}</strong> · {LAYER_META[0].name}</span>
              {layer0 ? (
                <span className={`study-status ${l0Legit != null && l0Legit < 0.6 ? "is-error" : "is-done"}`}>
                  legitimacy {Math.round((l0Legit == null ? 1 : l0Legit) * 100)}%
                </span>
              ) : (
                <span className="study-status is-none">○ runs automatically for zone extensions</span>
              )}
            </div>
            <p className="study-blurb muted">{LAYER_META[0].blurb}</p>
            {layer0 ? (
              <div className="layer0-body">
                {layer0.primary_cause ? <span className="pill">{String(layer0.primary_cause).replace(/_/g, " ")}</span> : null}
                {layer0.verdict ? <p className="digest-text"><strong>{layer0.verdict}</strong></p> : null}
                {layer0.summary ? <p className="digest-text">{layer0.summary}</p> : null}
                {layer0.sentiment_note ? <p className="comp-line"><span className="l">Trajectory:</span> {layer0.sentiment_note}</p> : null}
                {l0Legit != null && l0Legit < 0.6 ? (
                  <p className="study-notice">
                    ⚠ Low legitimacy — demoted in the Opportunity Zone (its low rating looks like noise, not a fixable product gap).
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Layer 1 — quick competitive read (headless pipeline) */}
          <div className="study-layer">
            <div className="study-layer-head">
              <span className="study-icon">{LAYER_META[1].icon}</span>
              <span className="study-name"><strong>{LAYER_META[1].short}</strong> · {LAYER_META[1].name}</span>
              <span className={`study-status ${l1Done ? "is-done" : ddStatus === "queued" ? "is-queued" : ddStatus === "error" ? "is-error" : "is-none"}`}>
                {l1Done ? "✅ done" : ddStatus === "queued" ? "⏳ queued" : ddStatus === "error" ? "⚠️ failed" : "○ not started"}
              </span>
            </div>
            <p className="study-blurb muted">{LAYER_META[1].blurb}</p>
            <DeepDiveButton extId={ext.ext_id} status={ddStatus} />
          </div>

          {/* Layer 2 — deep competitor study (skill-driven, needs Layer 1) */}
          <StudyLayer
            extId={ext.ext_id} layer={2} meta={LAYER_META[2]}
            status={study2 ? study2.status : "none"} prompt={l2Prompt}
            locked={!l1Done} lockMsg="Run Layer 1 first — the deep-dive layers are sequential."
            uploadedAt={study2 ? study2.uploaded_at : null}
            sourceFilename={study2 ? study2.source_filename : null}
          />

          {/* Layer 3 — financial study (skill-driven, needs Layer 2) */}
          <StudyLayer
            extId={ext.ext_id} layer={3} meta={LAYER_META[3]}
            status={study3 ? study3.status : "none"} prompt={l3Prompt}
            locked={!l2Done} lockMsg="Finish Layer 2 first — the deep-dive layers are sequential."
            uploadedAt={study3 ? study3.uploaded_at : null}
            sourceFilename={study3 ? study3.source_filename : null}
          />
        </section>
      )}

      {d.configured && !d.notFound && !d.error && l2Done && (
        <StudyReport meta={LAYER_META[2]} study={study2} extName={extName} />
      )}
      {d.configured && !d.notFound && !d.error && l3Done && (
        <StudyReport meta={LAYER_META[3]} study={study3} extName={extName} />
      )}

      {d.configured && !d.notFound && !d.error && dd && dd.status === "done" && (
        <section className="digest deepdive">
          <h2>
            🔬 Deep dive{" "}
            {dd.recommendation ? (
              <span className={`verdict verdict-${dd.recommendation}`}>{dd.recommendation}</span>
            ) : null}
          </h2>
          <p className="sub">
            Comprehensive research by the Claude layer (reviews + competitors)
            {dd.analyzed_at ? <> · {fmtDate(dd.analyzed_at)}</> : null}.
          </p>

          {dd.what_it_is ? (
            <div className="card digest-card">
              <h3>What it is</h3>
              <p className="digest-text">{dd.what_it_is}</p>
            </div>
          ) : null}

          {dd.review_summary ? (
            <div className="card digest-card">
              <h3>Deep review read</h3>
              <p className="digest-text">{dd.review_summary}</p>
            </div>
          ) : null}

          {competitors.length > 0 ? (
            <div className="card digest-card">
              <h3>Competitors ({competitors.length})</h3>
              <CompetitorGraph name={ext?.name || ext?.ext_id || "This extension"} competitors={competitors} />
              <ul className="competitors">
                {competitors.map((c, i) => (
                  <li key={i} className="competitor">
                    <div className="competitor-head">
                      <span className="competitor-name">
                        {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}
                      </span>
                      {c.pricing ? <span className="pill">{c.pricing}</span> : null}
                    </div>
                    {c.strengths ? <p className="comp-line"><span className="l">Strengths:</span> {c.strengths}</p> : null}
                    {c.weaknesses ? <p className="comp-line"><span className="l">Weaknesses:</span> {c.weaknesses}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {dd.opportunity ? (
            <div className="card digest-card">
              <h3>The opportunity</h3>
              <p className="digest-text">{dd.opportunity}</p>
            </div>
          ) : null}

          {Array.isArray(dd.sources) && dd.sources.length > 0 ? (
            <p className="digest-sources">
              Sources:{" "}
              {dd.sources.slice(0, 8).map((s, i) => (
                <span key={i}>
                  {i ? " · " : ""}
                  <a href={s} target="_blank" rel="noreferrer">{i + 1}</a>
                </span>
              ))}
            </p>
          ) : null}
        </section>
      )}

      {d.configured && !d.notFound && !d.error && (whatItDoes || clusters.length > 0 || mon) && (
        <section className="digest">
          <h2>
            Opportunity digest{" "}
            {declining ? <span className="trend-badge" title={declineTitle}>↓ Declining</span> : null}
          </h2>
          <p className="sub">
            Built by the Claude ranking layer
            {opp && opp.score != null ? <> · opportunity score <strong>{Number(opp.score).toFixed(1)}</strong></> : null}
            {opp && opp.build_effort ? <> · est. build <strong>{opp.build_effort}</strong></> : null}
            {declining ? <> · <span className="trend-down" title={declineTitle}>quality trending down</span></> : null}.
          </p>

          {whatItDoes ? (
            <div className="card digest-card">
              <h3>What it does</h3>
              <p className="digest-text">{whatItDoes}</p>
            </div>
          ) : null}

          {clusters.length > 0 ? (
            <div className="card digest-card">
              <h3>User problems ({clusters.length} cluster{clusters.length === 1 ? "" : "s"})</h3>
              <p className="sub">Recurring complaints, grouped — with how many distinct reviewers raised each.</p>
              <ul className="clusters">
                {clusters
                  .slice()
                  .sort((a, b) => (b.independent_reviewers || 0) - (a.independent_reviewers || 0))
                  .map((c, i) => (
                    <li key={i} className="cluster">
                      <div className="cluster-head">
                        <span className="reviewers" title="distinct reviewers who raised this">
                          {fmt(c.independent_reviewers)} reviewer{c.independent_reviewers === 1 ? "" : "s"}
                        </span>
                        {c.complaint_type ? <span className="pill">{c.complaint_type}</span> : null}
                        {c.fixable ? <span className="pill" title="fixable by a small competitor?">fixable: {c.fixable}</span> : null}
                      </div>
                      <p className="cluster-complaint">{c.complaint}</p>
                      {Array.isArray(c.wtp_quotes) && c.wtp_quotes.length > 0 ? (
                        <ul className="wtp">
                          {c.wtp_quotes.map((q, j) => (
                            <li key={j}>“{q}”</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          {mon ? (
            <div className="card digest-card">
              <h3>Profitability</h3>
              {mon.monetization_summary ? <p className="digest-text">{mon.monetization_summary}</p> : null}
              <dl className="profit-grid">
                <div><dt>Pricing model</dt><dd><span className="pill">{mon.pricing_model || "unknown"}</span></dd></div>
                <div><dt>Paid tier</dt><dd>{mon.has_paid_tier ? "Yes" : "No"}</dd></div>
                <div><dt>Price range</dt><dd>{range(mon.price_min_usd, mon.price_max_usd)}</dd></div>
                <div><dt>Est. users</dt><dd>{fmt(mon.estimated_users)}</dd></div>
                <div><dt>Est. revenue / mo</dt><dd><strong>{usd(mon.estimated_monthly_revenue_usd)}</strong></dd></div>
                <div><dt>Revenue range / mo</dt><dd>{range(mon.revenue_low_usd, mon.revenue_high_usd)}</dd></div>
                <div><dt>Confidence</dt><dd>{mon.confidence || "—"}</dd></div>
              </dl>
              {mon.pricing_notes ? <p className="muted digest-notes">{mon.pricing_notes}</p> : null}
              {Array.isArray(mon.sources) && mon.sources.length > 0 ? (
                <p className="digest-sources">
                  Sources:{" "}
                  {mon.sources.slice(0, 6).map((s, i) => (
                    <span key={i}>
                      {i ? " · " : ""}
                      <a href={s} target="_blank" rel="noreferrer">{i + 1}</a>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      )}

      {d.configured && !d.notFound && !d.error && !opp && !mon && (!dd || dd.status !== "done") && (
        <section>
          <p className="empty">
            No Claude analysis for this extension yet — run the ranking layer (the
            {" "}<strong>“Run ExtensionMiner Ranking”</strong> button) to generate the summary,
            problem clusters, and profitability. Use <strong>“Add to deep-dive pool”</strong> above
            for competitor research.
          </p>
        </section>
      )}

      {d.configured && !d.notFound && !d.error && (
        <section>
          <h2>{fmt(d.reviews.length)} saved review{d.reviews.length === 1 ? "" : "s"}</h2>
          <p className="sub">
            Straight from your scraped data{savedAvg ? <> · avg <strong>{savedAvg}★</strong> across saved reviews</> : null}
            {helpfulCount ? <> · <strong>{fmt(helpfulCount)}</strong> flagged 👍 helpful</> : null}.
          </p>

          {d.reviews.length === 0 ? (
            <p className="empty">
              No reviews saved for this extension yet. Run the scraper to collect them.
            </p>
          ) : (
            <ReviewList rows={d.reviews} variant="saved" defaultSort="date-desc" />
          )}
        </section>
      )}
    </main>
  );
}
