from analysis.layer0 import (
    CauseShare,
    Layer0Report,
    build_user_prompt,
    classify_reviews,
    legitimacy_from_categories,
    to_review_analysis_row,
    _sort_for_weighting,
)


def _report(**kw):
    base = dict(
        verdict="Low rating is a real, fixable sync bug.",
        primary_cause="product_issues",
        categories=[CauseShare(cause="product_issues", share=1.0, note="repeated sync complaints")],
        summary="Most negativity is genuine product pain around syncing.",
        sentiment_note="Recent reviews are worse than older ones.",
    )
    base.update(kw)
    return Layer0Report(**base)


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


def test_legitimacy_all_product_issues_is_high():
    assert legitimacy_from_categories(_report()) == 1.0


def test_legitimacy_review_bombing_is_low():
    r = _report(
        primary_cause="review_bombing",
        categories=[
            CauseShare(cause="review_bombing", share=0.8, note="kids angry at a school filter"),
            CauseShare(cause="product_issues", share=0.2, note="a couple of real bugs"),
        ],
    )
    # weighted: (0.0*0.8 + 1.0*0.2) / 1.0 = 0.2
    assert legitimacy_from_categories(r) == 0.2


def test_legitimacy_praise_is_excluded_from_the_average():
    r = _report(
        primary_cause="mixed",
        categories=[
            CauseShare(cause="praise", share=0.5, note="lots of fans"),
            CauseShare(cause="product_issues", share=0.5, note="real bugs"),
        ],
    )
    # praise is dropped, so legitimacy is driven entirely by product_issues = 1.0
    assert legitimacy_from_categories(r) == 1.0


def test_legitimacy_model_override_wins_and_is_clamped():
    assert legitimacy_from_categories(_report(legitimacy=0.42)) == 0.42
    # no categories -> fall back to the primary cause weight
    assert legitimacy_from_categories(_report(primary_cause="competitor_attack", categories=[])) == 0.1


def test_sort_for_weighting_puts_helpful_and_recent_first():
    reviews = [
        {"stars": 4, "body": "old", "reviewed_at": "2024-01-01", "helpful_count": 0},
        {"stars": 1, "body": "helpful flagged", "reviewed_at": "2023-01-01", "helpful_ranked": True},
        {"stars": 2, "body": "recent", "reviewed_at": "2026-05-01", "helpful_count": 3},
    ]
    ordered = _sort_for_weighting(reviews)
    assert ordered[0]["body"] == "helpful flagged"   # helpful_ranked beats everything
    assert ordered[1]["body"] == "recent"            # then helpful_count / recency


def test_build_user_prompt_marks_helpful_and_lists_reviews():
    text = build_user_prompt(
        {"name": "Tab Tool", "rating": 3.1, "rating_count": 200, "install_count": 1000,
         "store_category": "Productivity"},
        [{"stars": 1, "body": "sync broken", "reviewed_at": "2026-01-01", "helpful_ranked": True}],
    )
    assert "Tab Tool" in text
    assert "1★" in text and "sync broken" in text
    assert "👍" in text                               # helpful flag surfaced
    assert "most-helpful" in text.lower()


def test_classify_reviews_wires_the_call_without_web_tools():
    expected = _report()
    client = _FakeClient(expected)
    out = classify_reviews(client, {"name": "Tab Tool"}, [{"stars": 1, "body": "x"}], model="claude-opus-4-8")
    assert out is expected
    call = client.messages.calls[0]
    assert call["model"] == "claude-opus-4-8"
    assert call["output_format"] is Layer0Report
    assert call["thinking"] == {"type": "adaptive"}
    assert "tools" not in call                         # Layer 0 is review-only, no web search


def test_to_review_analysis_row_shape():
    row = to_review_analysis_row(7, _report(), model="claude-opus-4-8", reviews_analyzed=40)
    assert row["extension_id"] == 7
    assert row["status"] == "done"
    assert row["model"] == "claude-opus-4-8"
    assert row["reviews_analyzed"] == 40
    assert row["legitimacy"] == 1.0
    assert row["primary_cause"] == "product_issues"
    assert isinstance(row["categories"], list) and row["categories"][0]["cause"] == "product_issues"
    assert row["error"] is None
    assert isinstance(row["details"], dict) and "categories" in row["details"]
