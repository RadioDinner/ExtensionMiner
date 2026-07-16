import { describe, expect, it } from "vitest";
import { planAutoApply, runAutoApply, summarizeAutoApply, type AutoApplyAction } from "../src/shared/auto-apply";
import type { MatchResult } from "../src/shared/matcher";
import type { AmazarchSettings } from "../src/shared/settings";

function match(status: MatchResult["status"], id: string): MatchResult {
  return {
    charge: { id, date: "2026-07-01", amountCents: -1234, merchantName: "Amazon", name: "Amazon", notes: "" },
    order:
      status === "auto" || status === "review"
        ? { orderId: `o-${id}`, date: "2026-06-30", totalCents: 1234, itemTitles: ["Thing"] }
        : null,
    candidateCount: 1,
    status,
    dayDiff: 1,
  };
}

const s = (over: Partial<AmazarchSettings>): AmazarchSettings => ({
  autoMatch: true,
  autoNote: true,
  autoRename: true,
  ...over,
});

describe("planAutoApply", () => {
  const matches = [match("auto", "a1"), match("review", "r1"), match("unmatched", "u1"), match("auto", "a2")];

  it("plans nothing when the master toggle is off", () => {
    expect(planAutoApply(matches, s({ autoMatch: false }))).toEqual([]);
  });

  it("plans nothing when both sub-toggles are off", () => {
    expect(planAutoApply(matches, s({ autoNote: false, autoRename: false }))).toEqual([]);
  });

  it("targets ONLY exact (auto) matches — review and unmatched stay manual", () => {
    const plan = planAutoApply(matches, s({}));
    expect(plan.map((a) => `${a.match.charge.id}:${a.kind}`)).toEqual([
      "a1:note",
      "a1:rename",
      "a2:note",
      "a2:rename",
    ]);
  });

  it("respects the sub-toggles independently", () => {
    expect(planAutoApply(matches, s({ autoRename: false })).map((a) => a.kind)).toEqual(["note", "note"]);
    expect(planAutoApply(matches, s({ autoNote: false })).map((a) => a.kind)).toEqual(["rename", "rename"]);
  });
});

describe("runAutoApply", () => {
  const actions: AutoApplyAction[] = planAutoApply([match("auto", "a1"), match("auto", "a2")], s({}));

  it("counts applied / skipped / refuted / failed correctly", async () => {
    const results = [
      { ok: true, note: "note added", verified: true, undo: () => Promise.resolve() }, // applied
      { ok: true, note: "already named" }, // skipped (no undo = nothing changed)
      { ok: true, note: "rename not applied", verified: false as const, undo: () => {} }, // refuted
      { ok: false, note: "HTTP 500" }, // failed
    ];
    let i = 0;
    const sum = await runAutoApply(actions, async () => results[i++]!);
    expect(sum).toEqual({ actions: 4, applied: 1, skipped: 1, refuted: 1, failed: 1 });
  });

  it("a thrown action counts as failed and does not stop the run", async () => {
    let calls = 0;
    const sum = await runAutoApply(actions.slice(0, 2), async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return { ok: true, note: "note added", undo: () => {} };
    });
    expect(calls).toBe(2);
    expect(sum.failed).toBe(1);
    expect(sum.applied).toBe(1);
  });

  it("reports progress and paces between actions but not after the last", async () => {
    const progress: string[] = [];
    let pauses = 0;
    await runAutoApply(
      actions,
      async () => ({ ok: true, note: "ok", undo: () => {} }),
      {
        onProgress: (n, total, a) => progress.push(`${n}/${total}:${a.kind}`),
        pause: async () => {
          pauses += 1;
        },
      },
    );
    expect(progress).toEqual(["1/4:note", "2/4:rename", "3/4:note", "4/4:rename"]);
    expect(pauses).toBe(3);
  });
});

describe("summarizeAutoApply", () => {
  it("mentions the refresh hint only when something was applied", () => {
    expect(summarizeAutoApply({ actions: 4, applied: 3, skipped: 1, refuted: 0, failed: 0 })).toBe(
      "Auto-match: 3 applied, 1 already done — refresh Monarch to see changes.",
    );
    expect(summarizeAutoApply({ actions: 2, applied: 0, skipped: 2, refuted: 0, failed: 0 })).toBe(
      "Auto-match: 0 applied, 2 already done.",
    );
  });

  it("rolls refuted and failed into one failure count", () => {
    expect(summarizeAutoApply({ actions: 4, applied: 1, skipped: 1, refuted: 1, failed: 1 })).toBe(
      "Auto-match: 1 applied, 1 already done, 2 failed — refresh Monarch to see changes.",
    );
  });
});
