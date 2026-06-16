from analysis import prompt
from analysis.rank import (
    PENALTY_JUST_BAD,
    analyze_extension,
    score_opportunity,
    to_opportunity_row,
)
from analysis.schema import ExtensionAnalysis, ReviewCluster


def _analysis(**kw):
    base = dict(
        clusters=[],
        overall_just_bad=False,
        needs_heavy_backend=False,
        build_effort="20-40 hrs",
        brief="A brief.",
    )
    base.update(kw)
    return ExtensionAnalysis(**base)


STRONG_CLUSTER = ReviewCluster(
    complaint="No way to sync across devices",
    complaint_type="missing_feature",
    fixable="yes",
    independent_reviewers=8,
    wtp_quotes=["I would pay for this if it synced", "Take my money if you add sync"],
)


def test_strong_opportunity_scores_high():
    ext = {"rating": 3.0, "install_count": 500_000, "name": "Demo"}
    s = score_opportunity(ext, _analysis(clusters=[STRONG_CLUSTER]))
    assert s["top_complaint"] == "No way to sync across devices"
    assert s["complaint_type"] == "missing_feature"
    assert s["fixable"] == "yes"
    assert s["demand_intensity"] == 8
    assert len(s["wtp_evidence"]) == 2
    assert s["score"] > 70  # demand + wtp + fixable + market + zone


def test_just_bad_is_penalized():
    ext = {"rating": 3.0, "install_count": 500_000}
    good = score_opportunity(ext, _analysis(clusters=[STRONG_CLUSTER]))
    bad = score_opportunity(ext, _analysis(clusters=[STRONG_CLUSTER], overall_just_bad=True))
    assert bad["score"] == round(max(0.0, good["score"] - PENALTY_JUST_BAD), 1) or bad["score"] < good["score"]
    assert bad["score"] < good["score"]


def test_no_fixable_cluster_yields_zero_demand():
    ext = {"rating": 3.0, "install_count": 100_000}
    analysis = _analysis(
        clusters=[
            ReviewCluster(
                complaint="UI is ugly",
                complaint_type="other",
                fixable="no",
                independent_reviewers=3,
                wtp_quotes=[],
            )
        ]
    )
    s = score_opportunity(ext, analysis)
    assert s["top_complaint"] is None
    assert s["demand_intensity"] == 0


def test_zone_bonus_only_in_range():
    analysis = _analysis(clusters=[STRONG_CLUSTER])
    in_zone = score_opportunity({"rating": 3.0, "install_count": 1000}, analysis)["score"]
    out_zone = score_opportunity({"rating": 4.8, "install_count": 1000}, analysis)["score"]
    assert in_zone > out_zone


def test_to_opportunity_row_shape():
    ext = {"rating": 3.0, "install_count": 500_000}
    row = to_opportunity_row(42, ext, _analysis(clusters=[STRONG_CLUSTER]), model="claude-opus-4-8")
    assert row["extension_id"] == 42
    assert row["model"] == "claude-opus-4-8"
    assert row["complaint_type"] in ("missing_feature", "bug", "pricing", "abandonment", "other")
    assert isinstance(row["wtp_evidence"], list)
    assert isinstance(row["details"], dict) and "clusters" in row["details"]


def test_build_user_prompt_includes_reviews():
    text = prompt.build_user_prompt(
        {"name": "Tab Tool", "rating": 3.1, "install_count": 1000, "store_category": "productivity"},
        [{"stars": 2, "body": "if X worked I'd pay", "reviewed_at": "2024-09-05"}],
    )
    assert "Tab Tool" in text
    assert "2★" in text
    assert "if X worked" in text


class _FakeParsed:
    def __init__(self, out):
        self.parsed_output = out


class _FakeMessages:
    def __init__(self, out):
        self.out = out
        self.calls = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeParsed(self.out)


class _FakeClient:
    def __init__(self, out):
        self.messages = _FakeMessages(out)


def test_analyze_extension_wires_the_call():
    expected = _analysis(clusters=[STRONG_CLUSTER])
    client = _FakeClient(expected)
    out = analyze_extension(client, {"name": "Demo"}, [{"stars": 2, "body": "x"}], model="claude-opus-4-8")
    assert out is expected
    call = client.messages.calls[0]
    assert call["model"] == "claude-opus-4-8"
    assert call["output_format"] is ExtensionAnalysis
    assert call["thinking"] == {"type": "adaptive"}
    assert call["messages"][0]["role"] == "user"
