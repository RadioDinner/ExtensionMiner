// Static in-app help / guide. The deeper written manual lives at docs/GUIDE.md.
export const metadata = { title: "Help · ExtensionMiner" };

function Card({ title, children }) {
  return (
    <div className="help-card">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

export default function Help() {
  return (
    <main className="wrap">
      <header>
        <span className="kicker">Help</span>
        <h1>How ExtensionMiner works</h1>
        <p>
          A field guide to the whole system — what it does, how to run it, and how to use the
          dashboard. The deeper written manual is <code>docs/GUIDE.md</code> in the repo.
        </p>
        <p className="topnav">
          <a href="/">← Dashboard</a>{" · "}
          <a href="/scraper-settings">Scraper settings</a>{" · "}
          <a href="/diagnostics">Diagnostics</a>
        </p>
      </header>

      <section>
        <h2>The 30-second version</h2>
        <p className="sub">
          ExtensionMiner scrapes the Chrome Web Store into Supabase, runs a Claude ranking layer
          over the reviews to score <em>opportunities</em>, and shows them here.
        </p>
        <div className="banner">
          <strong>The one goal:</strong> find <strong>ONE</strong> extension worth building a
          competitor against — the <strong>~3★ "opportunity zone"</strong>: real demand (high
          installs) but unhappy users, where reviews say <em>"if X worked, I'd pay for this."</em>
          The miner is research; the product is the fixed extension you build afterward.
        </div>
      </section>

      <section>
        <h2>The workflow</h2>
        <ol className="help-steps">
          <li><strong>Set up once</strong> — fill <code>.env</code> (Supabase + Anthropic keys),
            apply the SQL migrations, deploy the dashboard. (See <code>docs/GUIDE.md §4</code>.)</li>
          <li><strong>Configure the crawl</strong> — open <a href="/scraper-settings">Scraper
            settings</a>, set categories/caps, and turn on the <em>opportunity-zone review gate</em>
            and <em>skip-already-saved-reviews</em>. Save.</li>
          <li><strong>Scrape</strong> (locally) — the <strong>Run Scraper</strong> button fills
            the <code>extensions</code> + <code>reviews</code> tables.</li>
          <li><strong>Rank</strong> (locally) — the <strong>Run Ranking</strong> button fills
            <code> opportunities</code>, <code>monetization</code>, and any queued deep dives.</li>
          <li><strong>Explore</strong> — work the Opportunity zone, dismiss non-targets, open
            promising ones to read the digest.</li>
          <li><strong>Deep dive</strong> the finalists, then <strong>pick ONE</strong>.</li>
        </ol>
        <p className="sub">
          The scraper and ranking layer run on <strong>your machine</strong> — the Chrome Web Store
          is blocked from the cloud environment, so scraping happens locally; the dashboard just
          reads what they wrote to Supabase.
        </p>
      </section>

      <section>
        <h2>Using the dashboard</h2>
        <div className="help-grid">
          <Card title="★ Opportunity zone">
            The curated top-25 in the 2.5–3.5★ band. Click a column to <strong>sort</strong>, use the
            <strong> filters</strong>, click a name to read its reviews. Hit <span className="help-kbd">✕</span>
            to <strong>dismiss</strong> a non-target (pick a reason) — it drops out and the next
            candidate <strong>backfills</strong> to keep 25. Restore via "Show dismissed from zone".
          </Card>
          <Card title="Rating vs installs scatter">
            Demand (installs) vs satisfaction (rating); gold dots in the band are targets.
            <strong> Click a dot</strong> to open it. A numbered dot means several extensions stack
            there — click it and the chart <strong>pops into a detailed grid</strong> of those
            extensions. <span className="help-kbd">⤢ Expand</span> opens a larger, labeled view.
          </Card>
          <Card title="Scored opportunities">
            Claude-ranked targets: top fixable complaint, type, fixability, <strong>Recency</strong>
            (how fresh the complaints are) and <strong>Trend</strong> (is it getting worse?). Filter
            by complaint type / pricing; sort by score or "declining fastest".
          </Card>
          <Card title="Ranking mode toggle">
            <strong>⚡ Incremental</strong> (default) scores only newly-added extensions, so re-runs
            cost no tokens. Flip to <strong>🔁 Full re-run</strong> to re-score everything once, then
            flip back. The setting is saved in Supabase and read by the ranking layer.
          </Card>
          <Card title="Deep-dive layers (0–3)">
            The deep dive is <strong>layered</strong>, and the manual layers run <strong>in order</strong>:
            <br /><strong>🧪 Layer 0 — Review legitimacy</strong> (automatic): for every zone extension,
            reads the reviews (recent + helpful weighted) to judge <em>why</em> the rating is what it is.
            Low legitimacy (review-bombing, off-topic, competitor attacks) <strong>demotes</strong> it in
            the zone — there's no fixable product gap to win.
            <br /><strong>🔬 Layer 1 — Quick read</strong>: <strong>Add to deep-dive pool</strong>, then run
            the ranking layer → a deep review read, a <strong>competitor graph</strong>, and a
            build/maybe/avoid verdict.
            <br /><strong>🔭 Layer 2 — Competitor study</strong> &amp; <strong>💰 Layer 3 — Financial study</strong>
            (need the prior layer): <strong>Generate &amp; copy the research prompt</strong>, run it in a
            Claude session with the <strong>deep-research skill</strong>, then <strong>upload the exported
            PDF</strong> (or paste the text). You get the full report plus structured competitors,
            opportunities, and (Layer 3) the money picture.
            <br />The home-page <strong>Deep dive</strong> column shows Layer 1 status:
            <span className="dd-status dd-done"> 🔬</span> done
            <span className="dd-status dd-queued"> ⏳</span> queued
            <span className="dd-status dd-error"> ⚠️</span> error
            <span className="dd-status dd-none"> ○</span> none.
          </Card>
          <Card title="Extension detail page">
            The <strong>opportunity digest</strong>: what it does, clustered user problems (with
            reviewer counts + "I'd pay if…" quotes), and the monetization breakdown — plus every
            saved review (sortable) and any deep-dive results.
          </Card>
        </div>
      </section>

      <section>
        <h2>Quick tips</h2>
        <ul className="help-tips">
          <li><strong>Scrape only the zone:</strong> Scraper settings → <em>Only save reviews for
            in-zone extensions</em>. You still catalog every extension's metadata; you just skip the
            slow review fetch outside 2.5–3.5★.</li>
          <li><strong>Cheap repeat crawls:</strong> turn on <em>Skip reviews if ≥ N already saved</em>
            (try 10) — only extensions with new ratings re-fetch reviews.</li>
          <li><strong>Re-rank without burning tokens:</strong> leave Ranking mode on Incremental;
            use Full re-run (or CLI <code>--force</code>) only when you really want to re-score all.</li>
          <li><strong>Speed up scraping:</strong> the zone gate + skip-already-saved avoid most
            review fetches; <code>--concurrency N</code> overlaps the slow on-page work; lower the
            rate limit for less-polite-but-faster.</li>
          <li><strong>Something blank?</strong> open <a href="/diagnostics">/diagnostics</a> — usually
            a migration not applied, a stale schema cache (reload it), or the wrong Supabase key.</li>
        </ul>
      </section>

      <section>
        <h2>Running it (your machine)</h2>
        <div className="help-grid">
          <Card title="Run Scraper">
            Set things in <a href="/scraper-settings">Scraper settings</a> → click the Desktop
            <strong> Run Scraper</strong> button (it runs <code>scraper.run --use-saved-settings</code>).
            By hand: <code>python -m scraper.run --categories productivity/tools --max-extensions 25</code>.
          </Card>
          <Card title="Run Ranking">
            Click the Desktop <strong>Run ExtensionMiner Ranking</strong> button — it ranks, researches
            monetization, runs the <strong>Layer 0</strong> review-legitimacy pre-screen, and processes the
            Layer 1 deep-dive queue. By hand:
            <code> python -m analysis.run --monetize</code>. Add <code>--force</code> for a full re-run;
            <code> --skip-layer0</code> / <code>--skip-deep-dive</code> to skip a pass.
          </Card>
        </div>
        <p className="sub">Full run guides: <code>docs/RUNNING_THE_RANKER.md</code> and <code>scraper/README.md</code>.</p>
      </section>

      <section>
        <h2>Glossary</h2>
        <ul className="help-tips">
          <li><strong>Opportunity zone</strong> — extensions at 2.5–3.5★ with real installs: demand + dissatisfaction.</li>
          <li><strong>WTP ("I'd pay if…")</strong> — willingness-to-pay signals mined from reviews; the strongest demand evidence.</li>
          <li><strong>Demand intensity</strong> — how many independent reviewers raise the same fixable complaint.</li>
          <li><strong>Recency weight</strong> — discounts old complaints (they describe old releases).</li>
          <li><strong>Decline / trend</strong> — is the extension getting worse? A weakening incumbent is a better target.</li>
          <li><strong>Deep dive</strong> — opt-in, token-frugal competitor research for hand-picked finalists.</li>
        </ul>
      </section>

      <p style={{ marginTop: 28 }}>
        <a href="/">← Back to dashboard</a> · Full written manual: <code>docs/GUIDE.md</code>
      </p>
    </main>
  );
}
