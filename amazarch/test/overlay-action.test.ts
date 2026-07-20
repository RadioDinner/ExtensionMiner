// @vitest-environment jsdom
// Regression tests for the panel's click-to-apply button. Through v0.4.10 the
// undo was wired via btn.onclick while the original addEventListener handler
// stayed attached, so clicking Undo also re-ran the action (two racing writes)
// and clicks after "Undone" silently re-applied it. These tests pin the
// one-listener state machine: apply once → undo once → inert, plus the
// verification semantics (refuted apply → retry; refuted undo → stays armed;
// unknown → labeled "(unconfirmed)") and the armed-undo registry that
// survives panel redraws.
import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: { runtime: { getManifest: () => ({ version: "0.0.0-test" }) } },
}));

import {
  actionButton,
  ago,
  armUndo,
  clampToViewport,
  fmtDayDiff,
  parsePanelUi,
  type ApplyOutcome,
  type ApplyResult,
} from "../src/content/monarch/overlay";

let keyCounter = 0;
function freshKey(): string {
  keyCounter += 1;
  return `txn-${keyCounter}:test`;
}

/** Click and let the async handler settle. */
async function click(btn: HTMLElement): Promise<void> {
  (btn as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function harness(result?: Partial<ApplyResult>, undoResult?: Partial<ApplyOutcome>, key = freshKey()) {
  let runs = 0;
  let undos = 0;
  const btn = actionButton("Rename merchant", key, async () => {
    runs += 1;
    return {
      ok: true,
      note: "renamed",
      verified: true,
      undo: async () => {
        undos += 1;
        return { ok: true, note: "restored", verified: true, ...undoResult };
      },
      ...result,
    };
  }) as HTMLButtonElement;
  return { btn, key, runs: () => runs, undos: () => undos };
}

describe("actionButton state machine", () => {
  it("applies once, then arms undo", async () => {
    const h = harness();
    await click(h.btn);
    expect(h.runs()).toBe(1);
    expect(h.undos()).toBe(0);
    expect(h.btn.textContent).toBe("✓ renamed — undo");
  });

  it("clicking undo runs ONLY the undo — it must not re-run the action", async () => {
    const h = harness();
    await click(h.btn); // apply
    await click(h.btn); // undo
    expect(h.runs()).toBe(1); // the v0.4.10 bug made this 2
    expect(h.undos()).toBe(1);
    expect(h.btn.textContent).toBe("Undone ✓");
  });

  it("after undo the button is spent — further clicks do nothing", async () => {
    const h = harness();
    await click(h.btn);
    await click(h.btn);
    await click(h.btn);
    await click(h.btn);
    expect(h.runs()).toBe(1); // the v0.4.10 bug re-applied on every click here
    expect(h.undos()).toBe(1);
    expect(h.btn.textContent).toBe("Undone ✓");
  });

  it("a result without undo goes straight to spent", async () => {
    const h = harness({ undo: undefined, note: "already named" });
    await click(h.btn);
    await click(h.btn);
    expect(h.runs()).toBe(1);
    expect(h.btn.textContent).toBe("✓ already named");
  });

  it("a failed apply stays retryable", async () => {
    let calls = 0;
    const btn = actionButton("Add note", freshKey(), async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, note: "HTTP 500" }
        : { ok: true, note: "note added", verified: true };
    }) as HTMLButtonElement;
    await click(btn);
    expect(btn.textContent).toBe("Failed: HTTP 500 — retry");
    await click(btn);
    expect(calls).toBe(2);
    expect(btn.textContent).toBe("✓ note added");
  });

  it("a failed undo stays armed for retry without re-running the action", async () => {
    let undoCalls = 0;
    let runs = 0;
    const btn = actionButton("Rename merchant", freshKey(), async () => {
      runs += 1;
      return {
        ok: true,
        note: "renamed",
        verified: true,
        undo: async () => {
          undoCalls += 1;
          return undoCalls === 1
            ? { ok: false, note: "timeout" }
            : { ok: true, note: "restored", verified: true };
        },
      };
    }) as HTMLButtonElement;
    await click(btn); // apply
    await click(btn); // undo fails
    expect(btn.textContent).toBe("Undo failed: timeout — retry");
    await click(btn); // undo retried
    expect(runs).toBe(1);
    expect(undoCalls).toBe(2);
    expect(btn.textContent).toBe("Undone ✓");
  });

  it("a thrown apply is caught and retryable", async () => {
    let calls = 0;
    const btn = actionButton("Add note", freshKey(), async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return { ok: true, note: "note added", verified: true };
    }) as HTMLButtonElement;
    await click(btn);
    expect(btn.textContent).toBe("Failed: boom — retry");
    await click(btn);
    expect(btn.textContent).toBe("✓ note added");
  });
});

describe("actionButton verification semantics", () => {
  it("a REFUTED apply (verified=false) returns to idle for retry — no undo for a write that did not take", async () => {
    const h = harness({ verified: false, note: "rename not applied" });
    await click(h.btn);
    expect(h.btn.textContent).toBe("⚠ rename not applied — retry");
    await click(h.btn); // retry re-runs the action, it does NOT undo
    expect(h.runs()).toBe(2);
    expect(h.undos()).toBe(0);
  });

  it("an UNCONFIRMED apply (verified=null) is labeled differently from a confirmed one", async () => {
    const h = harness({ verified: null, note: "renamed (unconfirmed)" });
    await click(h.btn);
    expect(h.btn.textContent).toBe("✓ renamed (unconfirmed) — undo");
  });

  it("a REFUTED undo stays armed for an idempotent retry", async () => {
    let undoCalls = 0;
    // Undo sequence: refuted first, confirmed second.
    const btn = actionButton("Add note", freshKey(), async () => ({
      ok: true,
      note: "note added",
      verified: true,
      undo: async () => {
        undoCalls += 1;
        return undoCalls === 1
          ? { ok: true, note: "restored", verified: false }
          : { ok: true, note: "restored", verified: true };
      },
    })) as HTMLButtonElement;
    await click(btn); // apply
    await click(btn); // undo — Monarch refutes it
    expect(btn.textContent).toBe("⚠ Undo not applied — retry");
    await click(btn); // retry undo — confirmed now
    expect(undoCalls).toBe(2);
    expect(btn.textContent).toBe("Undone ✓");
  });

  it("an UNCONFIRMED undo (verified=null) is spent but labeled honestly", async () => {
    const h = harness({}, { verified: null });
    await click(h.btn);
    await click(h.btn);
    expect(h.btn.textContent).toBe("Undone (unconfirmed)");
    expect(h.undos()).toBe(1);
  });
});

describe("armed-undo registry (survives panel redraws)", () => {
  it("a rebuilt button with the same key restores the armed undo", async () => {
    const key = freshKey();
    const h = harness({}, undefined, key);
    await click(h.btn); // apply → armed
    // Simulate draw() rebuilding the panel: a brand-new button, same key.
    const rebuilt = actionButton("Rename merchant", key, async () => {
      throw new Error("must not re-run the action");
    }) as HTMLButtonElement;
    expect(rebuilt.textContent).toBe("✓ renamed — undo"); // label restored
    await click(rebuilt); // runs the ORIGINAL undo
    expect(h.undos()).toBe(1);
    expect(rebuilt.textContent).toBe("Undone ✓");
  });

  it("a refuted undo's warning label survives a redraw", async () => {
    const key = freshKey();
    let undoCalls = 0;
    const btn = actionButton("Add note", key, async () => ({
      ok: true,
      note: "note added",
      verified: true,
      undo: async () => {
        undoCalls += 1;
        return { ok: true, note: "restored", verified: false };
      },
    })) as HTMLButtonElement;
    await click(btn); // apply
    await click(btn); // undo — refuted
    const rebuilt = actionButton("Add note", key, async () => {
      throw new Error("must not re-run the action");
    }) as HTMLButtonElement;
    expect(rebuilt.textContent).toBe("⚠ Undo not applied — retry"); // warning, not "✓ … — undo"
    await click(rebuilt); // retry undo still wired
    expect(undoCalls).toBe(2);
  });

  it("a spent undo does not leak into rebuilt buttons", async () => {
    const key = freshKey();
    const h = harness({}, undefined, key);
    await click(h.btn); // apply
    await click(h.btn); // undo → spent, registry cleared
    const rebuilt = actionButton("Rename merchant", key, async () => ({
      ok: true,
      note: "renamed",
      verified: true,
    })) as HTMLButtonElement;
    expect(rebuilt.textContent).toBe("Rename merchant"); // fresh idle button
  });
});

describe("armUndo (external arming for auto-apply)", () => {
  it("arms a button created afterwards, and its click runs the auto-apply undo", async () => {
    const key = freshKey();
    let undos = 0;
    armUndo(key, {
      ok: true,
      note: "note added",
      verified: true,
      undo: async () => {
        undos += 1;
        return { ok: true, note: "restored", verified: true };
      },
    });
    const btn = actionButton("Add note", key, async () => {
      throw new Error("must not re-run the action");
    }) as HTMLButtonElement;
    expect(btn.textContent).toBe("✓ note added — undo");
    await click(btn);
    expect(undos).toBe(1);
    expect(btn.textContent).toBe("Undone ✓");
  });

  it("does NOT arm for refuted, failed, or no-op results", () => {
    const cases: ApplyResult[] = [
      { ok: false, note: "HTTP 500" },
      { ok: true, note: "rename not applied", verified: false, undo: async () => ({ ok: true, note: "x" }) },
      { ok: true, note: "already noted" }, // no undo — nothing changed
    ];
    for (const r of cases) {
      const key = freshKey();
      armUndo(key, r);
      const btn = actionButton("Add note", key, async () => ({ ok: true, note: "note added", verified: true }));
      expect(btn.textContent).toBe("Add note"); // stayed idle
    }
  });
});

describe("fmtDayDiff", () => {
  it("signs the value itself — no garbled '(+-1d)' for pre-order charges", () => {
    expect(fmtDayDiff(3)).toBe("  (+3d)");
    expect(fmtDayDiff(0)).toBe("  (+0d)");
    expect(fmtDayDiff(-1)).toBe("  (-1d)");
    expect(fmtDayDiff(null)).toBe("");
  });
});

describe("parsePanelUi", () => {
  it("defaults to the corner, not minimized", () => {
    expect(parsePanelUi(undefined)).toEqual({ x: null, y: null, minimized: false });
    expect(parsePanelUi(null)).toEqual({ x: null, y: null, minimized: false });
    expect(parsePanelUi("junk")).toEqual({ x: null, y: null, minimized: false });
  });
  it("accepts a full position + minimized flag", () => {
    expect(parsePanelUi({ x: 40, y: 120, minimized: true })).toEqual({ x: 40, y: 120, minimized: true });
  });
  it("falls back to the corner when only one coordinate is set", () => {
    expect(parsePanelUi({ x: 40, minimized: false })).toEqual({ x: null, y: null, minimized: false });
    expect(parsePanelUi({ y: 120 })).toEqual({ x: null, y: null, minimized: false });
    expect(parsePanelUi({ x: 40, y: Infinity })).toEqual({ x: null, y: null, minimized: false });
  });
});

describe("clampToViewport", () => {
  it("keeps a box fully on screen with a margin", () => {
    // Panel 340x400 in a 1000x800 viewport, dragged off the bottom-right.
    expect(clampToViewport(9999, 9999, 340, 400, 1000, 800, 8)).toEqual({ x: 652, y: 392 });
    // Dragged off the top-left.
    expect(clampToViewport(-50, -50, 340, 400, 1000, 800, 8)).toEqual({ x: 8, y: 8 });
    // A position already inside is unchanged.
    expect(clampToViewport(100, 100, 340, 400, 1000, 800, 8)).toEqual({ x: 100, y: 100 });
  });
  it("does not go negative when the panel is larger than the viewport", () => {
    expect(clampToViewport(500, 500, 900, 900, 400, 400, 8)).toEqual({ x: 8, y: 8 });
  });
});

describe("ago", () => {
  it("formats relative time compactly", () => {
    const now = 1_000_000_000;
    expect(ago(now, now)).toBe("just now");
    expect(ago(now - 30_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5m ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(ago(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
})
