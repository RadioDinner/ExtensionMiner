import datetime as dt

from analysis import prompt
from analysis.rank import (
    PENALTY_JUST_BAD,
    RECENCY_FLOOR,
    W_DECLINE,
    analyze_extension,
    recency_factor,
    recency_weight,
    score_opportunity,
    to_opportunity_row,
    trend_signal,
)
from analysis.schema import ExtensionAnalysis, ReviewCluster

NOW = dt.date(2026, 6, 17)


def _days_ago(n: int) -> str:
    return (NOW - dt.timedelta(days=n)).isoformat()


def _analysis(**kw):
    base = dict(
        what_it_does="A tab manager that groups open tabs.",
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
    # The "what it does" overview rides along in details for the detail page.
    assert row["details"]["what_it_does"] == "A tab manager that groups open tabs."


def test_what_it_does_is_required():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ExtensionAnalysis(
            clusters=[], overall_just_bad=False, needs_heavy_backend=False,
            build_effort="x", brief="y",
        )


def test_recency_weight_follows_the_decay_curve():
    # Monotonically non-increasing across the buckets the user specified.
    w_fresh = recency_weight(_days_ago(10), now=NOW)     # <= 3 months
    w_6mo = recency_weight(_days_ago(150), now=NOW)       # <= 6 months
    w_12mo = recency_weight(_days_ago(300), now=NOW)      # <= 12 months
    w_2yr = recency_weight(_days_ago(600), now=NOW)       # <= 2 years
    w_3yr = recency_weight(_days_ago(1000), now=NOW)      # <= 3 years
    w_old = recency_weight(_days_ago(2000), now=NOW)      # > 3 years
    assert w_fresh == 1.0
    assert w_fresh > w_6mo > w_12mo > w_2yr > w_3yr > w_old
    assert w_old == RECENCY_FLOOR


def test_recency_weight_unknown_or_future_is_full_weight():
    assert recency_weight(None, now=NOW) == 1.0
    assert recency_weight("not-a-date", now=NOW) == 1.0
    assert recency_weight((NOW + dt.timedelta(days=30)).isoformat(), now=NOW) == 1.0


def test_recency_factor_is_judged_from_complaint_reviews():
    # Fresh complaints (<=3 stars) -> high factor even if old 5-star praise exists.
    reviews = [
        {"stars": 1, "reviewed_at": _days_ago(20)},
        {"stars": 2, "reviewed_at": _days_ago(40)},
        {"stars": 5, "reviewed_at": _days_ago(2000)},  # old praise, ignored
    ]
    assert recency_factor(reviews, now=NOW) == 1.0

    # Old complaints -> heavily discounted.
    stale = [
        {"stars": 1, "reviewed_at": _days_ago(1500)},
        {"stars": 2, "reviewed_at": _days_ago(2000)},
    ]
    assert recency_factor(stale, now=NOW) == RECENCY_FLOOR


def test_recency_factor_falls_back_and_defaults_to_one():
    # No complaint reviews -> average over all dated reviews.
    only_praise = [{"stars": 5, "reviewed_at": _days_ago(2000)}]
    assert recency_factor(only_praise, now=NOW) == RECENCY_FLOOR
    # Nothing dated -> no penalty.
    assert recency_factor([{"stars": 1, "reviewed_at": None}], now=NOW) == 1.0
    assert recency_factor([], now=NOW) == 1.0


def test_recency_discounts_demand_but_not_the_raw_count():
    ext = {"rating": 3.0, "install_count": 500_000}
    fresh = score_opportunity(ext, _analysis(clusters=[STRONG_CLUSTER]), recency=1.0)
    stale = score_opportunity(ext, _analysis(clusters=[STRONG_CLUSTER]), recency=RECENCY_FLOOR)
    assert stale["score"] < fresh["score"]          # old complaints rank lower
    assert stale["demand_intensity"] == fresh["demand_intensity"] == 8  # count unchanged
    assert fresh["recency_weight"] == 1.0
    assert stale["recency_weight"] == RECENCY_FLOOR


def test_to_opportunity_row_threads_recency():
    ext = {"rating": 3.0, "install_count": 500_000}
    row = to_opportunity_row(7, ext, _analysis(clusters=[STRONG_CLUSTER]), model="m", recency=0.5)
    assert row["recency_weight"] == 0.5


def test_trend_signal_detects_decline():
    reviews = (
        [{"stars": 1, "reviewed_at": _days_ago(30)} for _ in range(4)]    # recent: angry
        + [{"stars": 5, "reviewed_at": _days_ago(300)} for _ in range(4)]  # prior: happy
    )
    t = trend_signal(reviews, now=NOW)
    assert t["recent_rating"] == 1.0
    assert t["baseline_rating"] == 5.0
    assert t["complaint_trend"] == 1.0          # neg share went 0 -> 100%
    assert t["decline_score"] == 1.0            # rating drop + surge, capped at 1


def test_trend_signal_steady_and_improving_are_zero():
    steady = [{"stars": 4, "reviewed_at": _days_ago(d)} for d in (20, 40, 60, 300, 360, 420)]
    assert trend_signal(steady, now=NOW)["decline_score"] == 0.0
    # Improving (recent better than prior) must not register as decline.
    improving = (
        [{"stars": 5, "reviewed_at": _days_ago(30)} for _ in range(3)]
        + [{"stars": 2, "reviewed_at": _days_ago(300)} for _ in range(3)]
    )
    assert trend_signal(improving, now=NOW)["decline_score"] == 0.0


def test_trend_signal_needs_enough_in_each_window():
    thin = (
        [{"stars": 1, "reviewed_at": _days_ago(30)} for _ in range(2)]   # only 2 recent
        + [{"stars": 5, "reviewed_at": _days_ago(300)} for _ in range(5)]
    )
    t = trend_signal(thin, now=NOW)
    assert t["decline_score"] == 0.0
    assert t["recent_rating"] is None and t["baseline_rating"] is None


def test_decline_bonus_raises_score_and_lands_in_row():
    ext = {"rating": 3.0, "install_count": 500_000}
    base = score_opportunity(ext, _analysis(clusters=[STRONG_CLUSTER]), decline=0.0)
    worse = score_opportunity(ext, _analysis(clusters=[STRONG_CLUSTER]), decline=1.0)
    assert worse["score"] == round(base["score"] + W_DECLINE, 1)
    assert worse["decline_score"] == 1.0

    trend = {"decline_score": 0.8, "recent_rating": 2.1, "baseline_rating": 3.4, "complaint_trend": 0.5}
    row = to_opportunity_row(9, ext, _analysis(clusters=[STRONG_CLUSTER]), model="m", trend=trend)
    assert row["decline_score"] == 0.8
    assert row["recent_rating"] == 2.1 and row["baseline_rating"] == 3.4
    assert row["complaint_trend"] == 0.5


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
