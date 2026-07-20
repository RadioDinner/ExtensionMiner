import { describe, expect, it } from "vitest";
import { evaluateWriteGate, type GateInputs } from "../src/shared/write-gate";
import type { Entitlement } from "../src/shared/licensing";
import type { RemoteConfigEval } from "../src/shared/remote-config";

const okRemote: RemoteConfigEval = { writesEnabled: true, updateRequired: false, message: null };
const ent = (over: Partial<Entitlement>): Entitlement => ({
  allowed: false, status: "none", plan: null, daysLeft: null, detail: "", ...over,
});
const gate = (over: Partial<GateInputs>): ReturnType<typeof evaluateWriteGate> =>
  evaluateWriteGate({ licensingConfigured: true, entitlement: ent({}), remote: okRemote, ...over });

describe("evaluateWriteGate — kill switch precedence", () => {
  it("update-required overrides everything, even a valid license", () => {
    const g = gate({
      entitlement: ent({ allowed: true, status: "active" }),
      remote: { writesEnabled: true, updateRequired: true, message: null },
    });
    expect(g).toMatchObject({ allowed: false, reason: "update-required", cta: "update" });
  });

  it("paused (read-only safe mode) overrides a valid license", () => {
    const g = gate({
      entitlement: ent({ allowed: true, status: "active" }),
      remote: { writesEnabled: false, updateRequired: false, message: null },
    });
    expect(g).toMatchObject({ allowed: false, reason: "paused", cta: null });
  });

  it("a custom remote message is surfaced", () => {
    const g = gate({ remote: { writesEnabled: false, updateRequired: false, message: "back in an hour" } });
    expect(g.message).toBe("back in an hour");
  });
});

describe("evaluateWriteGate — licensing", () => {
  it("unconfigured licensing leaves writes open (pre-launch/self-hosted)", () => {
    expect(gate({ licensingConfigured: false })).toMatchObject({ allowed: true, reason: "unconfigured" });
  });

  it("active license allows writes", () => {
    expect(gate({ entitlement: ent({ allowed: true, status: "active" }) })).toMatchObject({
      allowed: true, reason: "ok",
    });
  });

  it("trial allows writes and reports days left", () => {
    const g = gate({ entitlement: ent({ allowed: true, status: "trial", daysLeft: 5 }) });
    expect(g).toMatchObject({ allowed: true, reason: "trial", daysLeft: 5 });
    expect(g.message).toContain("5 days left");
  });

  it("expired trial denies with a buy CTA", () => {
    expect(gate({ entitlement: ent({ status: "trial-expired" }) })).toMatchObject({
      allowed: false, reason: "trial-expired", cta: "buy",
    });
  });

  it("lapsed subscription denies with a buy CTA", () => {
    expect(gate({ entitlement: ent({ status: "expired" }) })).toMatchObject({
      allowed: false, reason: "expired", cta: "buy",
    });
  });

  it("no license/trial denies with a trial CTA", () => {
    expect(gate({ entitlement: ent({ status: "none" }) })).toMatchObject({
      allowed: false, reason: "needs-license", cta: "trial",
    });
  });
});
