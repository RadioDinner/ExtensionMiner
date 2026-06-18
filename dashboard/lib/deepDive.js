// Deep-dive status, shown as one icon per extension in the lists. The
// `deep_dives.status` column (migration 993) is 'queued' | 'done' | 'error';
// an extension with no row has never been added to the pool ('none').
export const DEEP_DIVE_META = {
  done: { icon: "🔬", title: "Deep-dive researched (done)", cls: "dd-done" },
  queued: { icon: "⏳", title: "Queued for deep dive", cls: "dd-queued" },
  error: { icon: "⚠️", title: "Deep dive failed on its last run", cls: "dd-error" },
  none: { icon: "○", title: "Not in the deep-dive pool", cls: "dd-none" },
};

export function deepDiveMeta(status) {
  return DEEP_DIVE_META[status] || DEEP_DIVE_META.none;
}

// Sort rank so a "Deep dive" column can sort done → queued → error → none.
export const DEEP_DIVE_RANK = { done: 3, queued: 2, error: 1, none: 0 };
