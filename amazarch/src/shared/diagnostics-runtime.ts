// Assemble diagnostic inputs from live extension state (permissions, background
// status, order store, license, write gate) into the non-PII shape that the
// pure buildDiagnosticReport formats. Deliberately passes COUNTS, not labels —
// no account names, order details, amounts, or tokens ever enter the report.
import browser from "webextension-polyfill";
import type { DiagnosticInputs } from "./diagnostics";
import type { StatusResponse } from "./messages";
import { loadOrderStore, summarizeAccounts } from "./order-store";
import { loadLicense, evaluateEntitlement } from "./licensing";
import { resolveWriteGate } from "./gate-runtime";
import { isLicensingConfigured } from "./config";

declare const __BROWSER__: string;

const MONARCH_ORIGINS = ["https://app.monarchmoney.com/*", "https://app.monarch.com/*"];
const AMAZON_ORIGINS = ["https://www.amazon.com/*"];

async function contains(origins: string[]): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins });
  } catch {
    return true; // permissions API hiccup — don't cry wolf in the report
  }
}

export async function collectDiagnostics(now: number = Date.now()): Promise<DiagnosticInputs> {
  const version = browser.runtime.getManifest().version;
  const browserName = typeof __BROWSER__ === "string" ? __BROWSER__ : "unknown";

  let status: StatusResponse | null = null;
  try {
    status = (await browser.runtime.sendMessage({ type: "get-status" })) as StatusResponse;
  } catch {
    /* background unreachable */
  }

  const [monarchAccess, amazonAccess, store, license, gate] = await Promise.all([
    contains(MONARCH_ORIGINS),
    contains(AMAZON_ORIGINS),
    loadOrderStore(),
    loadLicense(),
    resolveWriteGate(version, now),
  ]);
  const accounts = summarizeAccounts(store, null);
  const orders = accounts.reduce((n, a) => n + a.count, 0);
  const ent = evaluateEntitlement(license, now);

  return {
    version,
    browser: browserName,
    now,
    hostAccess: { monarch: monarchAccess, amazon: amazonAccess },
    monarch: {
      connected: status?.probe?.ok === true,
      authMethod: status?.monarch?.authMethod,
      host: status?.monarch?.origin ? safeHost(status.monarch.origin) : undefined,
      probeNote: status?.probe?.note,
    },
    amazonSignedIn: status?.amazon ? status.amazon.signedIn : null,
    counts: {
      amazonCharges: status?.read?.amazonCount ?? null,
      monarchTotal: status?.read?.totalCount ?? null,
      orders,
      accounts: accounts.length,
    },
    license: {
      configured: isLicensingConfigured(),
      status: ent.status,
      gateReason: gate.reason,
    },
    lastError: status?.probe && status.probe.ok === false ? status.probe.note : null,
  };
}

function safeHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return "—";
  }
}
