// The write gate composes the remote kill-switch and the licensing entitlement
// into ONE allow/deny decision consulted before any Monarch write (manual button
// or auto-match). Reads and matching never consult it — only writes are gated.
// Order of precedence: an update-required or paused kill-switch overrides
// everything (safety first, applies even pre-launch); then, only once licensing
// is configured, the entitlement decides. Pure + unit-tested.
import type { Entitlement } from "./licensing";
import type { RemoteConfigEval } from "./remote-config";

export type GateReason =
  | "ok" // writes allowed (licensed/active)
  | "trial" // writes allowed under the free trial
  | "unconfigured" // licensing not wired yet — open
  | "paused" // kill switch: read-only safe mode
  | "update-required" // version below the remote floor
  | "needs-license" // no trial/license — must start trial or buy
  | "trial-expired" // trial ended — must buy
  | "expired"; // subscription lapsed — must renew

export type GateCta = "trial" | "buy" | "update" | null;

export interface WriteGate {
  allowed: boolean;
  reason: GateReason;
  message: string; // "" when allowed with nothing to say
  cta: GateCta;
  daysLeft: number | null; // trial/subscription days remaining, when relevant
}

export interface GateInputs {
  licensingConfigured: boolean;
  entitlement: Entitlement;
  remote: RemoteConfigEval;
}

export function evaluateWriteGate({ licensingConfigured, entitlement, remote }: GateInputs): WriteGate {
  // 1. Kill switch — highest precedence, applies even before launch.
  if (remote.updateRequired) {
    return {
      allowed: false,
      reason: "update-required",
      message: remote.message ?? "Please update Amazarch to keep applying changes to Monarch.",
      cta: "update",
      daysLeft: null,
    };
  }
  if (!remote.writesEnabled) {
    return {
      allowed: false,
      reason: "paused",
      message:
        remote.message ??
        "Applying changes to Monarch is temporarily paused while we ship a fix. Matching still works — nothing is written.",
      cta: null,
      daysLeft: null,
    };
  }

  // 2. Pre-launch / self-hosted: nothing to enforce.
  if (!licensingConfigured) {
    return { allowed: true, reason: "unconfigured", message: "", cta: null, daysLeft: null };
  }

  // 3. Entitlement.
  if (entitlement.allowed) {
    return {
      allowed: true,
      reason: entitlement.status === "trial" ? "trial" : "ok",
      message:
        entitlement.status === "trial" && entitlement.daysLeft !== null
          ? `Free trial — ${entitlement.daysLeft} day${entitlement.daysLeft === 1 ? "" : "s"} left`
          : "",
      cta: null,
      daysLeft: entitlement.daysLeft,
    };
  }
  if (entitlement.status === "trial-expired") {
    return {
      allowed: false,
      reason: "trial-expired",
      message: "Your free trial has ended. Subscribe to keep applying matches to Monarch.",
      cta: "buy",
      daysLeft: 0,
    };
  }
  if (entitlement.status === "expired") {
    return {
      allowed: false,
      reason: "expired",
      message: "Your subscription has lapsed. Renew to keep applying matches to Monarch.",
      cta: "buy",
      daysLeft: null,
    };
  }
  return {
    allowed: false,
    reason: "needs-license",
    message: "Start your free trial or enter a license key to apply matches to Monarch.",
    cta: "trial",
    daysLeft: null,
  };
}
