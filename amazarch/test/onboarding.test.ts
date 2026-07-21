import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
  },
}));

import { computeOnboarding, parseOnboarding, type OnboardingSignals } from "../src/shared/onboarding";

const sig = (over: Partial<OnboardingSignals>): OnboardingSignals => ({
  hostAccess: false,
  monarchConnected: false,
  amazonSignedIn: null,
  firstSyncDone: false,
  ...over,
});

describe("computeOnboarding", () => {
  it("fresh install: first step is current, rest todo, not complete", () => {
    const b = computeOnboarding(sig({}));
    expect(b.steps.map((s) => s.status)).toEqual(["current", "todo", "todo"]);
    expect(b.steps.map((s) => s.id)).toEqual(["access", "monarch", "sync"]);
    expect(b.currentId).toBe("access");
    expect(b.complete).toBe(false);
  });

  it("advances the current marker to the sync step once access + Monarch are done", () => {
    const b = computeOnboarding(sig({ hostAccess: true, monarchConnected: true }));
    expect(b.steps.map((s) => s.status)).toEqual(["done", "done", "current"]);
    expect(b.currentId).toBe("sync");
  });

  it("completes on firstSyncDone (Amazon sign-in is folded into the sync step)", () => {
    const b = computeOnboarding(sig({ hostAccess: true, monarchConnected: true, firstSyncDone: true }));
    expect(b.complete).toBe(true);
    expect(b.currentId).toBeNull();
    expect(b.steps.every((s) => s.status === "done")).toBe(true);
  });

  it("shows a corrective hint when a sync ran while signed out of Amazon", () => {
    const b = computeOnboarding(sig({ hostAccess: true, monarchConnected: true, amazonSignedIn: false }));
    const sync = b.steps.find((s) => s.id === "sync")!;
    expect(sync.status).toBe("current");
    expect(sync.detail).toContain("didn't see an Amazon sign-in");
  });
});

describe("parseOnboarding", () => {
  it("coerces junk to defaults and reads valid values", () => {
    expect(parseOnboarding(null)).toEqual({ firstSyncDone: false, welcomedAt: null });
    expect(parseOnboarding({ firstSyncDone: true, welcomedAt: 123 })).toEqual({ firstSyncDone: true, welcomedAt: 123 });
    expect(parseOnboarding({ firstSyncDone: "yes" })).toEqual({ firstSyncDone: false, welcomedAt: null });
  });
});
