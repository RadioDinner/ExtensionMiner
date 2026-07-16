// Auto match: plan + run the automatic actions for exact matches. Pure — the
// actual writes (and their undo/verification semantics) are injected, so this
// is fully testable and index.ts reuses the same onApply/onRename paths as the
// manual buttons.
import type { MatchResult } from "./matcher";
import type { AmazarchSettings } from "./settings";

export interface AutoApplyAction {
  kind: "note" | "rename";
  match: MatchResult;
}

export interface AutoApplySummary {
  actions: number; // planned write actions
  applied: number; // writes that took effect (ok, not refuted, had an undo)
  skipped: number; // already noted / already named
  refuted: number; // Monarch accepted the write but reports it not applied
  failed: number; // request failed or threw
}

/** Which actions to run: EXACT ("auto") matches only — review stays manual. */
export function planAutoApply(matches: MatchResult[], s: AmazarchSettings): AutoApplyAction[] {
  if (!s.autoMatch || (!s.autoNote && !s.autoRename)) return [];
  const out: AutoApplyAction[] = [];
  for (const match of matches) {
    if (match.status !== "auto" || !match.order) continue;
    if (s.autoNote) out.push({ kind: "note", match });
    if (s.autoRename) out.push({ kind: "rename", match });
  }
  return out;
}

export interface AutoApplyRunResult {
  ok: boolean;
  note: string;
  verified?: boolean | null;
  undo?: unknown; // presence = the action changed something (vs "already done")
}

/** Run the planned actions sequentially (politely paced via opts.pause). */
export async function runAutoApply(
  actions: AutoApplyAction[],
  run: (a: AutoApplyAction) => Promise<AutoApplyRunResult>,
  opts: {
    onProgress?: (done: number, total: number, a: AutoApplyAction) => void;
    pause?: () => Promise<void>;
  } = {},
): Promise<AutoApplySummary> {
  const sum: AutoApplySummary = { actions: actions.length, applied: 0, skipped: 0, refuted: 0, failed: 0 };
  let done = 0;
  for (const a of actions) {
    try {
      const r = await run(a);
      if (!r.ok) sum.failed += 1;
      else if (r.verified === false) sum.refuted += 1;
      else if (r.undo) sum.applied += 1;
      else sum.skipped += 1;
    } catch {
      sum.failed += 1;
    }
    done += 1;
    opts.onProgress?.(done, actions.length, a);
    if (opts.pause && done < actions.length) await opts.pause();
  }
  return sum;
}

/** One status line summarizing an auto-apply pass. */
export function summarizeAutoApply(s: AutoApplySummary): string {
  const problems = s.refuted + s.failed;
  return (
    `Auto-match: ${s.applied} applied, ${s.skipped} already done` +
    (problems > 0 ? `, ${problems} failed` : "") +
    (s.applied > 0 ? " — refresh Monarch to see changes." : ".")
  );
}
