import CompetitorGraph from "../../CompetitorGraph";

// Render a completed Layer 2 / Layer 3 study: the structured signal (reliable,
// from the JSON block) rendered richly, plus the full narrative report in a
// collapsible block. Server component; CompetitorGraph is the only client bit.

function List({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <ul className="study-bullets">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

// The narrative comes out of a PDF as plain-ish text — render paragraphs, keep it
// readable, no markdown engine needed.
function Narrative({ text }) {
  const paras = String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) return null;
  return (
    <div className="study-narrative">
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

export default function StudyReport({ meta, study, extName }) {
  if (!study || study.status !== "done") return null;

  const competitors = Array.isArray(study.competitors) ? study.competitors : [];
  const opportunities = Array.isArray(study.opportunities) ? study.opportunities : [];
  const strengths = Array.isArray(study.target_strengths) ? study.target_strengths : [];
  const weaknesses = Array.isArray(study.target_weaknesses) ? study.target_weaknesses : [];
  const sources = Array.isArray(study.sources) ? study.sources : [];
  const fin = study.financials && typeof study.financials === "object" ? study.financials : {};
  const rec = study.recommendation;
  const isFinancial = meta.key === 3;

  return (
    <section className="digest deepdive study-report">
      <h2>
        {meta.icon} {meta.short} — {meta.name}{" "}
        {rec ? <span className={`verdict verdict-${rec}`}>{rec}</span> : null}
      </h2>
      <p className="sub">
        Deep research uploaded by you
        {study.uploaded_at ? <> · {String(study.uploaded_at).slice(0, 10)}</> : null}
        {study.source_filename ? <> · {study.source_filename}</> : null}.
      </p>

      {study.parse_warning ? <p className="study-notice">⚠ {study.parse_warning}</p> : null}

      {study.summary ? (
        <div className="card digest-card">
          <h3>Executive summary</h3>
          <p className="digest-text">{study.summary}</p>
        </div>
      ) : null}

      {(strengths.length > 0 || weaknesses.length > 0) && (
        <div className="card digest-card">
          <h3>{extName} — strengths &amp; weaknesses</h3>
          <div className="study-sw">
            {strengths.length > 0 ? (
              <div>
                <h4 className="sw-good">Strengths</h4>
                <List items={strengths} />
              </div>
            ) : null}
            {weaknesses.length > 0 ? (
              <div>
                <h4 className="sw-bad">Weaknesses</h4>
                <List items={weaknesses} />
              </div>
            ) : null}
          </div>
        </div>
      )}

      {isFinancial && (fin.revenue_model || fin.pricing || fin.estimated_revenue || (Array.isArray(fin.competitor_attacks) && fin.competitor_attacks.length) || (Array.isArray(fin.free_alternatives) && fin.free_alternatives.length)) ? (
        <div className="card digest-card">
          <h3>How it makes money &amp; how it's being attacked</h3>
          <dl className="profit-grid">
            {fin.revenue_model ? <div><dt>Revenue model</dt><dd>{fin.revenue_model}</dd></div> : null}
            {fin.pricing ? <div><dt>Pricing</dt><dd>{fin.pricing}</dd></div> : null}
            {fin.estimated_revenue ? <div><dt>Est. revenue</dt><dd>{fin.estimated_revenue}</dd></div> : null}
            {fin.pricing_opportunity ? <div><dt>Pricing opening</dt><dd>{fin.pricing_opportunity}</dd></div> : null}
          </dl>
          {Array.isArray(fin.competitor_attacks) && fin.competitor_attacks.length > 0 ? (
            <><h4 className="sw-bad">Competitor attacks</h4><List items={fin.competitor_attacks} /></>
          ) : null}
          {Array.isArray(fin.free_alternatives) && fin.free_alternatives.length > 0 ? (
            <><h4 className="sw-bad">Free alternatives capturing the market</h4><List items={fin.free_alternatives} /></>
          ) : null}
          {Array.isArray(fin.moat_risks) && fin.moat_risks.length > 0 ? (
            <><h4>Monetization risks / moats</h4><List items={fin.moat_risks} /></>
          ) : null}
        </div>
      ) : null}

      {competitors.length > 0 ? (
        <div className="card digest-card">
          <h3>Competitors ({competitors.length})</h3>
          <CompetitorGraph name={extName} competitors={competitors} />
          <ul className="competitors">
            {competitors.map((c, i) => (
              <li key={i} className="competitor">
                <div className="competitor-head">
                  <span className="competitor-name">
                    {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}
                  </span>
                  {c.pricing ? <span className="pill">{c.pricing}</span> : null}
                  {c.users ? <span className="pill">{c.users}</span> : null}
                </div>
                {c.positioning ? <p className="comp-line"><span className="l">Positioning:</span> {c.positioning}</p> : null}
                {c.strengths ? <p className="comp-line"><span className="l">Strengths:</span> {c.strengths}</p> : null}
                {c.weaknesses ? <p className="comp-line"><span className="l">Weaknesses:</span> {c.weaknesses}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {opportunities.length > 0 ? (
        <div className="card digest-card">
          <h3>Opportunities ({opportunities.length})</h3>
          <ul className="study-opps">
            {opportunities.map((o, i) => (
              <li key={i} className="study-opp">
                <div className="study-opp-head">
                  <span className="study-opp-title">{o.title || `Opportunity ${i + 1}`}</span>
                  {o.effort ? <span className="pill" title="rough build effort">effort: {o.effort}</span> : null}
                </div>
                {o.detail ? <p className="digest-text">{o.detail}</p> : null}
                {o.evidence ? <p className="comp-line"><span className="l">Evidence:</span> {o.evidence}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {study.report_md ? (
        <details className="card digest-card study-full">
          <summary>Full report</summary>
          <Narrative text={study.report_md} />
        </details>
      ) : null}

      {sources.length > 0 ? (
        <p className="digest-sources">
          Sources:{" "}
          {sources.slice(0, 12).map((s, i) => (
            <span key={i}>
              {i ? " · " : ""}
              <a href={s} target="_blank" rel="noreferrer">{i + 1}</a>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
