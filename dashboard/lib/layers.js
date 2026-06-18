// The layered deep-dive system — shared metadata for the dashboard.
//
//   Layer 0  Review legitimacy   automatic   why is the rating what it is?
//   Layer 1  Quick competitive   headless    one Claude pass (analysis/deepdive.py)
//   Layer 2  Competitor study    skill       deep research (paste prompt → upload PDF)
//   Layer 3  Financial study     skill       deep research (paste prompt → upload PDF)
//
// The manual layers are GATED: you can't queue Layer 2 until Layer 1 is done,
// nor Layer 3 until Layer 2 is done. Layer 0 is automatic and independent.

export const LAYER_META = {
  0: {
    key: 0,
    name: "Review legitimacy",
    short: "Layer 0",
    icon: "🧪",
    engine: "auto",
    blurb:
      "Automatic. Reads the reviews (recent + helpful weighted) to judge whether the rating reflects real, fixable problems — or noise like review-bombing. Low legitimacy demotes an extension in the Opportunity Zone.",
  },
  1: {
    key: 1,
    name: "Quick competitive read",
    short: "Layer 1",
    icon: "🔬",
    engine: "headless",
    blurb:
      "One Claude pass (run by the ranking layer): a deep read of the reviews plus a first look at the competitors and the opportunity.",
  },
  2: {
    key: 2,
    name: "Deep competitor study",
    short: "Layer 2",
    icon: "🔭",
    engine: "skill",
    requires: 1,
    blurb:
      "A thorough competitor study run by hand with Claude's deep-research skill: the full competitive landscape, each rival's strengths/weaknesses, and deeper opportunities. Requires Layer 1.",
  },
  3: {
    key: 3,
    name: "Financial study",
    short: "Layer 3",
    icon: "💰",
    engine: "skill",
    requires: 2,
    blurb:
      "How the extension makes money, and how competitors are attacking it — including free alternatives launched to capture the market. Run with the deep-research skill. Requires Layer 2.",
  },
};

// The two skill-driven, uploadable layers.
export const STUDY_LAYERS = [2, 3];

export function layerMeta(layer) {
  return LAYER_META[layer] || null;
}

// Status → small icon/label, like the Layer 1 pool indicators.
export const STUDY_STATUS_META = {
  done: { icon: "✅", label: "Report uploaded", cls: "dd-done" },
  queued: { icon: "⏳", label: "Queued — awaiting your report", cls: "dd-queued" },
  error: { icon: "⚠️", label: "Upload had a problem", cls: "dd-error" },
  none: { icon: "○", label: "Not started", cls: "dd-none" },
};

export function studyStatusMeta(status) {
  return STUDY_STATUS_META[status] || STUDY_STATUS_META.none;
}
