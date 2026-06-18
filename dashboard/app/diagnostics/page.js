import { getServerClient, isConfigured } from "../../lib/supabase";

// Request-time so it reflects the live env + DB, never the build.
export const dynamic = "force-dynamic";

// Tables the dashboard reads. Probing each one tells us exactly which read
// fails and why (RLS, missing relation, wrong project, …).
const TABLES = ["extensions", "reviews", "opportunities", "categories", "rating_snapshots"];

function refFromUrl(url) {
  try {
    return new URL(url).host.split(".")[0] || null; // https://<ref>.supabase.co
  } catch {
    return null;
  }
}

// Classify the key WITHOUT ever exposing it. Legacy keys are JWTs carrying a
// `role` claim; the new keys are prefixed sb_secret_ / sb_publishable_.
function classifyKey(key) {
  if (!key) return { kind: "not set", verdict: "fail", note: "No key in SUPABASE_SERVICE_ROLE_KEY." };
  if (key.startsWith("sb_secret_"))
    return { kind: "secret (new format)", verdict: "ok", note: "Bypasses RLS — correct for the dashboard." };
  if (key.startsWith("sb_publishable_"))
    return {
      kind: "publishable (new format)",
      verdict: "fail",
      note: "This is the WRONG key. Publishable keys obey RLS, so reads return nothing. Use the SECRET key.",
    };
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      if (payload.role === "service_role")
        return { kind: "service_role (JWT)", verdict: "ok", ref: payload.ref, note: "Bypasses RLS — correct." };
      if (payload.role === "anon")
        return {
          kind: "anon (JWT)",
          verdict: "fail",
          ref: payload.ref,
          note: "This is the WRONG key. The anon key obeys RLS, so reads return nothing. Use the service_role key.",
        };
      return { kind: `role="${payload.role}" (JWT)`, verdict: "warn", ref: payload.ref, note: "Unexpected role." };
    } catch {
      return { kind: "unreadable JWT", verdict: "warn", note: "Looks like a JWT but the payload wouldn't decode." };
    }
  }
  return { kind: "unrecognized format", verdict: "warn", note: "Not a known Supabase key shape." };
}

function Pill({ verdict }) {
  const label = verdict === "ok" ? "PASS" : verdict === "warn" ? "CHECK" : "FAIL";
  return <span className={`status ${verdict}`}>{label}</span>;
}

export default async function Diagnostics() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const urlRef = refFromUrl(url);
  const keyInfo = classifyKey(key);
  const refMismatch = Boolean(keyInfo.ref && urlRef && keyInfo.ref !== urlRef);

  const supabase = getServerClient();
  let probes = [];
  let sample = null;
  let sampleErr = null;
  if (supabase) {
    probes = await Promise.all(
      TABLES.map(async (t) => {
        const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
        return { table: t, count: count ?? null, error: error ? error.message : null };
      })
    );
    const r = await supabase.from("extensions").select("ext_id,name,rating,install_count").limit(3);
    sample = r.data;
    sampleErr = r.error ? r.error.message : null;
  }

  // Deep-dive pool state — this is what decides whether the 🔬 marker can show.
  // Probed separately from the core tables so a missing/empty 993 never flips the
  // main verdict to FAIL; it only explains the marker.
  let deepDive = null;
  if (supabase) {
    const counts = {};
    let readErr = null;
    for (const st of ["queued", "done", "error"]) {
      const { count, error } = await supabase
        .from("deep_dives")
        .select("*", { count: "exact", head: true })
        .eq("status", st);
      if (error) { readErr = error.message; break; }
      counts[st] = count ?? 0;
    }
    // Run the EXACT read the home page uses to place the marker, so a stale
    // PostgREST schema cache (embed can't resolve) shows up here as an error
    // instead of silently blanking the 🔬 on the dashboard.
    let markIds = [];
    let embedErr = null;
    if (!readErr) {
      const e = await supabase
        .from("deep_dives")
        .select("extensions(ext_id)")
        .eq("status", "done")
        .limit(2000);
      if (e.error) embedErr = e.error.message;
      else markIds = (e.data || []).map((d) => d.extensions?.ext_id).filter(Boolean);
    }
    deepDive = { counts, readErr, markIds, embedErr };
  }

  const extProbe = probes.find((p) => p.table === "extensions");
  const firstProbeErr = probes.map((p) => p.error).find(Boolean);

  // Single, plain-English verdict.
  let summary;
  if (!isConfigured) {
    summary = { verdict: "fail", msg: "Env vars are missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then redeploy." };
  } else if (keyInfo.verdict === "fail") {
    summary = { verdict: "fail", msg: `Wrong key: ${keyInfo.kind}. ${keyInfo.note}` };
  } else if (refMismatch) {
    summary = { verdict: "fail", msg: `Key project (${keyInfo.ref}) ≠ URL project (${urlRef}). The dashboard is pointed at a different project than the scraper writes to.` };
  } else if (firstProbeErr) {
    summary = { verdict: "fail", msg: `A query errored: ${firstProbeErr}` };
  } else if (extProbe && (extProbe.count || 0) === 0) {
    summary = { verdict: "warn", msg: "Connected with the right key, but the extensions table is genuinely empty. Run the scraper, then refresh." };
  } else {
    summary = { verdict: "ok", msg: `All good — ${extProbe ? extProbe.count : 0} extensions visible. The dashboard should be showing data.` };
  }

  return (
    <main className="wrap">
      <header>
        <span className="kicker">Diagnostics</span>
        <h1>Connection check</h1>
        <p>Why the dashboard is / isn't loading data. No secrets are shown — only key <em>type</em>, never the value.</p>
      </header>

      <div className={`banner diag-summary ${summary.verdict}`}>
        <Pill verdict={summary.verdict} /> {summary.msg}
      </div>

      <section>
        <h2>Environment</h2>
        <table>
          <tbody>
            <tr>
              <td>SUPABASE_URL</td>
              <td>{url ? <code>{url}</code> : <span className="status fail">FAIL</span>}</td>
            </tr>
            <tr>
              <td>URL project ref</td>
              <td>{urlRef || "—"}</td>
            </tr>
            <tr>
              <td>SUPABASE_SERVICE_ROLE_KEY</td>
              <td>{key ? `present (${key.length} chars)` : <span className="status fail">FAIL</span>}</td>
            </tr>
            <tr>
              <td>Key type</td>
              <td><Pill verdict={keyInfo.verdict} /> {keyInfo.kind}</td>
            </tr>
            {keyInfo.ref ? (
              <tr>
                <td>Key project ref</td>
                <td>
                  {keyInfo.ref}
                  {refMismatch ? <span className="status fail" style={{ marginLeft: 8 }}>≠ URL ref {urlRef}</span> : null}
                </td>
              </tr>
            ) : null}
            <tr>
              <td colSpan={2} className="muted">{keyInfo.note}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Table reads</h2>
        <p className="sub">Row count + error for each table, using the configured key.</p>
        {supabase ? (
          <table>
            <thead>
              <tr>
                <th>Table</th>
                <th className="num">Rows</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {probes.map((p) => (
                <tr key={p.table}>
                  <td>{p.table}</td>
                  <td className="num">{p.count == null ? "—" : Number(p.count).toLocaleString()}</td>
                  <td>{p.error ? <span className="status fail">{p.error}</span> : <span className="status ok">ok</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">Can't probe — no client (env vars not set).</p>
        )}
      </section>

      <section>
        <h2>Sample extensions</h2>
        {sampleErr ? (
          <div className="banner"><span className="status fail">FAIL</span> {sampleErr}</div>
        ) : sample && sample.length ? (
          <table>
            <thead>
              <tr>
                <th>ext_id</th>
                <th>Name</th>
                <th className="num">Rating</th>
                <th className="num">Installs</th>
              </tr>
            </thead>
            <tbody>
              {sample.map((r) => (
                <tr key={r.ext_id}>
                  <td><code>{r.ext_id}</code></td>
                  <td>{r.name}</td>
                  <td className="num">{r.rating ?? "—"}</td>
                  <td className="num">{r.install_count == null ? "—" : Number(r.install_count).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">No rows returned (see the verdict above for why).</p>
        )}
      </section>

      <section>
        <h2>Deep-dive pool (🔬 marker)</h2>
        <p className="sub">
          Why the <span className="dd-mark">🔬</span> does / doesn&apos;t appear on the dashboard. The
          marker only shows for dives that have <strong>completed</strong> (status <code>done</code>),
          and the home page reads them through the <code>deep_dives → extensions(ext_id)</code> embed
          tested here.
        </p>
        {!supabase ? (
          <p className="empty">Can&apos;t probe — no client (env vars not set).</p>
        ) : deepDive.readErr ? (
          <div className="banner">
            <span className="status fail">FAIL</span> Couldn&apos;t read <code>deep_dives</code>:{" "}
            {deepDive.readErr}
            <br />
            Apply <code>supabase/migrations/993_deep_dive_pool.sql</code> to this project (then the
            marker becomes possible once a dive completes).
          </div>
        ) : (
          <>
            <table>
              <tbody>
                <tr><td>Queued (waiting to run)</td><td className="num">{deepDive.counts.queued}</td></tr>
                <tr><td>Done (these get the 🔬)</td><td className="num">{deepDive.counts.done}</td></tr>
                <tr><td>Error (failed last run)</td><td className="num">{deepDive.counts.error}</td></tr>
                <tr>
                  <td>ext_ids the home page will mark</td>
                  <td className="num">
                    {deepDive.embedErr ? <span className="status fail">embed error</span> : deepDive.markIds.length}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className={`banner diag-summary ${
              deepDive.embedErr ? "fail"
              : deepDive.counts.done === 0 ? "warn"
              : deepDive.markIds.length === deepDive.counts.done ? "ok" : "warn"
            }`}>
              {deepDive.embedErr ? (
                <><Pill verdict="fail" /> {deepDive.counts.done} dive(s) are <code>done</code>, but the
                home-page embed failed: <em>{deepDive.embedErr}</em>. This is almost always a stale
                PostgREST schema cache — reload it (Supabase → Project Settings → API → “Reload schema”,
                or run <code>NOTIFY pgrst, &apos;reload schema&apos;</code>), then refresh the dashboard.</>
              ) : deepDive.counts.done === 0 ? (
                <><Pill verdict="warn" /> No completed deep dives yet, so there&apos;s nothing to mark.{" "}
                {deepDive.counts.queued > 0
                  ? <>You have {deepDive.counts.queued} <code>queued</code> — run the ranking layer with{" "}
                    <code>--deep-dive</code> (the “Run ExtensionMiner Ranking” button already includes it)
                    to complete them.</>
                  : deepDive.counts.error > 0
                    ? <>{deepDive.counts.error} dive(s) <code>errored</code> last run — re-queue them and
                      re-run; check the ranker log for why.</>
                    : <>Open an extension, click <strong>🔬 Add to deep-dive pool</strong>, then run the
                      ranking layer with <code>--deep-dive</code>.</>}</>
              ) : deepDive.markIds.length === deepDive.counts.done ? (
                <><Pill verdict="ok" /> {deepDive.counts.done} completed dive(s); the dashboard should show
                a 🔬 on those extensions. If you still don&apos;t see it, hard-refresh the page and confirm
                Vercel deployed the latest <code>main</code>.</>
              ) : (
                <><Pill verdict="warn" /> {deepDive.counts.done} done but only {deepDive.markIds.length}{" "}
                resolved an <code>ext_id</code> — some completed rows point at extensions missing an ext_id.</>
              )}
            </div>
          </>
        )}
      </section>

      <p style={{ marginTop: 28 }}><a href="/">← Back to dashboard</a></p>
    </main>
  );
}
