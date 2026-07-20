// Licensing / entitlement (Phase 1 commercialization). Amazarch keeps a small
// license state in storage.local and computes, purely, whether the user is
// entitled to the paid actions (applying matches to Monarch). Reads + matching
// are always free — only WRITES are gated (see write-gate.ts). The paid pitch
// is the refund/full-history/Firefox differentiators; the funnel lets users see
// every proposed match before subscribing.
//
// Provider-agnostic: validateKey POSTs the key to a configurable endpoint and
// parses a canonical response shape (parseLicenseResponse), so LemonSqueezy,
// Paddle, ExtPay, or a self-hosted checker all work behind the same interface.
// Offline-tolerant: a previously-validated license keeps working through a grace
// window when the server can't be reached — a paid product must never brick on a
// network blip. All pure logic is unit-tested; only validateKey does I/O.
import browser from "webextension-polyfill";
import { LICENSE_CONFIG, isLicensingConfigured } from "./config";

export type Plan = "monthly" | "yearly" | "lifetime";
export type EntitlementStatus = "none" | "trial" | "active" | "trial-expired" | "expired";

export interface LicenseState {
  key: string | null;
  plan: Plan | null;
  active: boolean; // last known server verdict for the key
  expiresAt: number | null; // ms; null = perpetual (lifetime) or unknown
  trialEndsAt: number | null; // ms; set once when the trial starts
  lastValidatedAt: number | null; // ms of the last SUCCESSFUL server check (grace anchor)
  lastError: string | null;
}

export const EMPTY_LICENSE: LicenseState = {
  key: null, plan: null, active: false, expiresAt: null,
  trialEndsAt: null, lastValidatedAt: null, lastError: null,
};

export interface Entitlement {
  allowed: boolean;
  status: EntitlementStatus;
  plan: Plan | null;
  daysLeft: number | null; // trial or subscription days remaining (null = perpetual/none)
  detail: string;
}

const DAY = 86400000;
const daysUp = (ms: number): number => Math.max(0, Math.ceil(ms / DAY));

/** Pure: is the user entitled to paid actions right now? Paid license first
 *  (with offline grace past expiry), then trial. */
export function evaluateEntitlement(
  s: LicenseState,
  now: number,
  graceDays: number = LICENSE_CONFIG.graceDays,
): Entitlement {
  if (s.active) {
    if (s.expiresAt === null) {
      return { allowed: true, status: "active", plan: s.plan, daysLeft: null, detail: "Licensed" };
    }
    if (now <= s.expiresAt) {
      return { allowed: true, status: "active", plan: s.plan, daysLeft: daysUp(s.expiresAt - now), detail: "Licensed" };
    }
    // Expired by date, but honor offline grace from the last successful check —
    // covers "renewed but we couldn't re-verify yet" and brief provider outages.
    if (s.lastValidatedAt !== null && now <= s.lastValidatedAt + graceDays * DAY) {
      return { allowed: true, status: "active", plan: s.plan, daysLeft: 0, detail: "Licensed (grace period)" };
    }
    return { allowed: false, status: "expired", plan: s.plan, daysLeft: null, detail: "Subscription expired" };
  }
  if (s.trialEndsAt !== null) {
    if (now <= s.trialEndsAt) {
      return { allowed: true, status: "trial", plan: null, daysLeft: daysUp(s.trialEndsAt - now), detail: "Free trial" };
    }
    return { allowed: false, status: "trial-expired", plan: null, daysLeft: 0, detail: "Trial ended" };
  }
  return { allowed: false, status: "none", plan: null, daysLeft: null, detail: "No license" };
}

// --- Provider response parsing (canonical shape) -----------------------------

export interface ParsedLicense {
  valid: boolean;
  plan: Plan | null;
  expiresAt: number | null;
  error: string | null;
}

function toMs(v: unknown): number | null {
  // Non-positive (0, negative) means "no expiry" (lifetime), not epoch/past.
  if (typeof v === "number" && Number.isFinite(v)) return v > 0 ? (v > 1e12 ? v : v * 1000) : null; // ms vs seconds
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Did the response actually carry a validity verdict? A body without one (an
 *  error page rendered as JSON, an empty object) must NOT be treated as an
 *  authoritative "invalid" — that would wrongly revoke a paying user. */
function hasValiditySignal(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const o = raw as Record<string, unknown>;
  return "valid" in o || "activated" in o || "status" in o;
}

/** Pure: map a provider's validate response to the canonical entitlement. The
 *  canonical shape is `{ valid, plan?, expiresAt?, error? }`; a few common
 *  aliases (activated/status, expires_at/expiry) are tolerated so a thin proxy
 *  is optional for simple providers. */
export function parseLicenseResponse(raw: unknown): ParsedLicense {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const statusStr = typeof o["status"] === "string" ? o["status"].toLowerCase() : "";
  const valid =
    o["valid"] === true ||
    o["activated"] === true ||
    statusStr === "active" ||
    statusStr === "valid";
  const planStr = typeof o["plan"] === "string" ? o["plan"].toLowerCase() : "";
  const plan: Plan | null = planStr === "monthly" || planStr === "yearly" || planStr === "lifetime" ? planStr : null;
  const expiresAt = toMs(o["expiresAt"] ?? o["expires_at"] ?? o["expiry"] ?? null);
  const error = typeof o["error"] === "string" ? o["error"] : valid ? null : "License not valid";
  return { valid, plan, expiresAt, error };
}

// --- Storage + I/O -----------------------------------------------------------

const KEY = "amazarchLicense";

/** Pure: coerce stored value into a valid license state. */
export function parseLicense(raw: unknown): LicenseState {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const planStr = typeof o["plan"] === "string" ? o["plan"] : "";
  return {
    key: typeof o["key"] === "string" ? o["key"] : null,
    plan: planStr === "monthly" || planStr === "yearly" || planStr === "lifetime" ? planStr : null,
    active: o["active"] === true,
    expiresAt: num(o["expiresAt"]),
    trialEndsAt: num(o["trialEndsAt"]),
    lastValidatedAt: num(o["lastValidatedAt"]),
    lastError: typeof o["lastError"] === "string" ? o["lastError"] : null,
  };
}

export async function loadLicense(): Promise<LicenseState> {
  try {
    const got = await browser.storage.local.get(KEY);
    return parseLicense((got as Record<string, unknown>)?.[KEY]);
  } catch {
    return { ...EMPTY_LICENSE };
  }
}

export async function saveLicense(s: LicenseState): Promise<void> {
  await browser.storage.local.set({ [KEY]: s });
}

/** Start the free trial once. Never restarts an already-started (or ended)
 *  trial — trialEndsAt, once set, is immutable (anti-abuse). No-op if a license
 *  key is already present or the trial is disabled. Only starts the clock once
 *  licensing is CONFIGURED — otherwise a pre-launch/self-hosted user would burn
 *  their trial while writes were open, then get zero trial the day enforcement
 *  turns on. */
export async function ensureTrialStarted(now: number = Date.now()): Promise<LicenseState> {
  const s = await loadLicense();
  if (!isLicensingConfigured() || LICENSE_CONFIG.trialDays <= 0) return s;
  if (s.trialEndsAt !== null || s.key !== null) return s;
  const next: LicenseState = { ...s, trialEndsAt: now + LICENSE_CONFIG.trialDays * DAY };
  await saveLicense(next);
  return next;
}

/** Validate a license key against the configured provider endpoint and persist
 *  the result. Fails OPEN: only a well-formed response that actually carries a
 *  validity verdict is authoritative. A 5xx, a non-JSON body, or a body without
 *  a verdict is treated as a transport error that PRESERVES the prior
 *  entitlement (grace covers it) — a paying user must never be revoked by a
 *  provider hiccup. An explicit `valid:false` (revoked/refunded/lapsed) IS
 *  honored, including on a 4xx that carries it. */
export async function validateKey(key: string, now: number = Date.now()): Promise<LicenseState> {
  const s = await loadLicense();
  if (!LICENSE_CONFIG.validateUrl) {
    const next: LicenseState = { ...s, key, lastError: "Licensing is not configured in this build." };
    await saveLicense(next);
    return next;
  }
  const preserve = async (reason: string): Promise<LicenseState> => {
    const next: LicenseState = { ...s, key, lastError: reason };
    await saveLicense(next);
    return next;
  };
  try {
    const res = await fetch(LICENSE_CONFIG.validateUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (res.status >= 500) return preserve(`License server error (${res.status}) — keeping your current license.`);
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return preserve("License server returned an unreadable response — keeping your current license.");
    }
    if (!hasValiditySignal(data)) {
      return preserve("Unexpected response from the license server — keeping your current license.");
    }
    const parsed = parseLicenseResponse(data);
    const next: LicenseState = {
      ...s,
      key,
      plan: parsed.plan ?? s.plan,
      active: parsed.valid,
      expiresAt: parsed.expiresAt,
      lastValidatedAt: parsed.valid ? now : s.lastValidatedAt,
      lastError: parsed.valid ? null : parsed.error,
    };
    await saveLicense(next);
    return next;
  } catch (e) {
    // Network/transport failure — keep the prior entitlement (grace), just note it.
    return preserve(`Could not reach the license server: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Re-validate the stored key if there is one and licensing is configured.
 *  Called on a background alarm so expiresAt/lastValidatedAt stay fresh — this
 *  is what makes the offline grace window actually bridge a renewal we couldn't
 *  immediately re-verify (without it, expiresAt goes stale and a paying
 *  subscriber is blocked at every renewal). No-op otherwise. */
export async function revalidateStoredKey(now: number = Date.now()): Promise<void> {
  if (!isLicensingConfigured()) return;
  const s = await loadLicense();
  if (s.key) await validateKey(s.key, now);
}

export async function clearLicense(): Promise<void> {
  await browser.storage.local.remove(KEY);
}
