// First-run onboarding (Phase 1 stranger-proofing). A brand-new user needs to be
// walked through connecting Monarch + Amazon and running the first sync — the
// extension can't work until those are done, and a stranger has no idea of the
// order. computeOnboarding turns the known signals into an ordered checklist so
// the welcome page and the popup can render live setup progress. Pure + tested;
// a tiny persisted flag records when the first sync succeeded.
import browser from "webextension-polyfill";

export interface OnboardingSignals {
  hostAccess: boolean; // site access granted for Monarch + Amazon
  monarchConnected: boolean; // the Monarch API session is live
  amazonSignedIn: boolean | null; // from the last sync; null = no sync yet
  firstSyncDone: boolean; // a sync has produced orders at least once
}

export type StepStatus = "done" | "current" | "todo";

export interface OnboardingStep {
  id: "access" | "monarch" | "sync";
  title: string;
  detail: string;
  status: StepStatus;
}

export interface Onboarding {
  steps: OnboardingStep[];
  complete: boolean;
  currentId: OnboardingStep["id"] | null;
}

/** Pure: build the ordered checklist from the current signals. The first
 *  not-done step is "current"; everything after it is "todo". Amazon sign-in is
 *  folded into the sync step because it can't be detected until a sync runs — a
 *  sync that ran while signed OUT surfaces as a corrective hint on that step. */
export function computeOnboarding(s: OnboardingSignals): Onboarding {
  const done: Record<OnboardingStep["id"], boolean> = {
    access: s.hostAccess,
    monarch: s.monarchConnected,
    sync: s.firstSyncDone,
  };
  const syncDetail =
    s.amazonSignedIn === false && !s.firstSyncDone
      ? "Amazarch synced but didn't see an Amazon sign-in. Open amazon.com, sign in, then click “Sync now” again."
      : 'Open amazon.com (signed in), then click "Sync now" in the Amazarch panel on Monarch — your orders are read and matched.';
  const defs: Omit<OnboardingStep, "status">[] = [
    {
      id: "access",
      title: "Allow site access",
      detail: "Amazarch needs access to app.monarch.com and amazon.com to read your orders and match them.",
    },
    {
      id: "monarch",
      title: "Open Monarch and sign in",
      detail: "Open app.monarch.com in a tab while signed in — Amazarch connects automatically and adds its panel.",
    },
    {
      id: "sync",
      title: "Sign in to Amazon and run your first sync",
      detail: syncDetail,
    },
  ];
  let currentAssigned = false;
  let currentId: OnboardingStep["id"] | null = null;
  const steps: OnboardingStep[] = defs.map((d) => {
    if (done[d.id]) return { ...d, status: "done" };
    if (!currentAssigned) {
      currentAssigned = true;
      currentId = d.id;
      return { ...d, status: "current" };
    }
    return { ...d, status: "todo" };
  });
  return { steps, complete: steps.every((s) => s.status === "done"), currentId };
}

// --- persisted flags ---------------------------------------------------------

export interface OnboardingState {
  firstSyncDone: boolean;
  welcomedAt: number | null; // when the welcome page was first shown
}

const KEY = "amazarchOnboarding";

/** Pure: coerce stored value. */
export function parseOnboarding(raw: unknown): OnboardingState {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    firstSyncDone: o["firstSyncDone"] === true,
    welcomedAt: typeof o["welcomedAt"] === "number" ? o["welcomedAt"] : null,
  };
}

export async function loadOnboarding(): Promise<OnboardingState> {
  try {
    const got = await browser.storage.local.get(KEY);
    return parseOnboarding((got as Record<string, unknown>)?.[KEY]);
  } catch {
    return { firstSyncDone: false, welcomedAt: null };
  }
}

async function patch(p: Partial<OnboardingState>): Promise<void> {
  const next = { ...(await loadOnboarding()), ...p };
  await browser.storage.local.set({ [KEY]: next });
}

/** Record that a sync produced orders — the last onboarding step. Idempotent. */
export async function markFirstSyncDone(): Promise<void> {
  const cur = await loadOnboarding();
  if (!cur.firstSyncDone) await patch({ firstSyncDone: true });
}

export async function markWelcomed(now: number = Date.now()): Promise<void> {
  const cur = await loadOnboarding();
  if (cur.welcomedAt === null) await patch({ welcomedAt: now });
}
