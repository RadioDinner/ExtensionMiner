// Build-time configuration for the paid product (Phase 1 commercialization).
// These are intentionally EMPTY until the owner wires a billing provider and a
// config host — while empty, licensing is "unconfigured" and every feature
// (including writes) stays open, so development and pre-launch use are
// unaffected. Filling validateUrl in turns enforcement on.
//
// Recommended wiring (COMMERCIALIZATION.md): a merchant-of-record provider
// (LemonSqueezy / Paddle) hosts checkout and a license-key API; a tiny
// serverless function maps the provider's validate response to this project's
// canonical shape (see licensing.parseLicenseResponse) AND keeps the provider
// API key server-side. buyUrl is the hosted checkout link. remoteConfigUrl
// points at a static JSON (see remote-config.ts) — the kill switch.

export interface LicenseConfig {
  /** POST {key} here; expects the canonical license JSON. Empty = unconfigured. */
  validateUrl: string;
  /** Hosted checkout / pricing page opened by "Buy" / "Subscribe". */
  buyUrl: string;
  /** Where to manage an existing subscription (billing portal). Optional. */
  manageUrl: string;
  /** Free-trial length in days (0 disables the trial). */
  trialDays: number;
  /** Offline grace: keep a lapsed-but-recently-valid license working this long. */
  graceDays: number;
}

export const LICENSE_CONFIG: LicenseConfig = {
  validateUrl: "",
  buyUrl: "",
  manageUrl: "",
  trialDays: 14,
  graceDays: 5,
};

/** Static JSON polled for the kill switch / min-version / banner. Empty = skip
 *  (defaults: writes enabled, no min version, no message). */
export const REMOTE_CONFIG_URL = "";

/** How long a fetched remote config is trusted before re-fetching. */
export const REMOTE_CONFIG_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Licensing enforces only once a provider endpoint is set. Until then the
 *  extension is fully open (pre-launch / self-hosted). */
export function isLicensingConfigured(): boolean {
  return LICENSE_CONFIG.validateUrl.trim().length > 0;
}
