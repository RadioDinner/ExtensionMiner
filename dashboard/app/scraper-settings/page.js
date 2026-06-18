import { getServerClient, isConfigured } from "../../lib/supabase";
import { DEFAULT_SCRAPER_SETTINGS, coerceScraperSettings } from "../../lib/scraperSettings";
import ScraperSettingsForm from "./ScraperSettingsForm";

// Request-time so it reflects the live DB, never the build.
export const dynamic = "force-dynamic";

export default async function ScraperSettings() {
  const supabase = getServerClient();
  let saved = DEFAULT_SCRAPER_SETTINGS;
  let error = null;

  if (supabase) {
    try {
      const { data, error: err } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "scraper_settings")
        .limit(1);
      if (err) error = err.message;
      else if (data && data[0] && data[0].value) saved = coerceScraperSettings(data[0].value);
    } catch (e) {
      error = String(e && e.message ? e.message : e);
    }
  }

  return (
    <main className="wrap">
      <header>
        <span className="kicker">Scraper</span>
        <h1>Scraper settings</h1>
        <p>
          Configure how the crawler runs. Saved to Supabase; the scraper picks these up when run
          with <code>--use-saved-settings</code> (the <strong>Run Scraper</strong> button). Tip:
          turn on <em>“Only save reviews for in-zone extensions”</em> to skip the slow review fetch
          for everything outside the {DEFAULT_SCRAPER_SETTINGS.zone_min}–{DEFAULT_SCRAPER_SETTINGS.zone_max}★
          opportunity zone.
        </p>
      </header>

      {!isConfigured ? (
        <div className="banner">
          <strong>Supabase not connected.</strong> Set <code>SUPABASE_URL</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code>, then reload. Settings can&apos;t be saved until then.
        </div>
      ) : error ? (
        <div className="banner">
          <strong>Couldn&apos;t read saved settings:</strong> {error}
          <br />
          If this mentions a missing relation, apply{" "}
          <code>supabase/migrations/991_app_settings.sql</code>.
        </div>
      ) : null}

      <ScraperSettingsForm initial={saved} disabled={!isConfigured} />

      <p style={{ marginTop: 28 }}><a href="/">← Back to dashboard</a></p>
    </main>
  );
}
