from analysis.deepdive import (
    Competitor,
    DeepDiveReport,
    WEB_TOOLS,
    build_user_prompt,
    research_deep_dive,
    to_deep_dive_row,
)


def _report(**kw):
    base = dict(
        what_it_is="A tab manager that groups open tabs.",
        review_summary="Users love the grouping but recent reviews flag sync bugs.",
        competitors=[
            Competitor(name="TabPro", url="https://tabpro.example", pricing="$5/mo",
                       strengths="Reliable sync", weaknesses="Cluttered UI"),
        ],
        opportunity="Build a clean, reliable sync — the recurring fixable pain.",
        recommendation="build",
        sources=["https://tabpro.example/pricing"],
    )
    base.update(kw)
    return DeepDiveReport(**base)


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


def test_build_user_prompt_includes_reviews_and_listing():
    text = build_user_prompt(
        {"name": "Tab Tool", "ext_id": "a" * 32, "install_count": 1000,
         "rating": 3.1, "rating_count": 200, "store_category": "Productivity / Tools",
         "website": "https://tabtool.example"},
        [{"stars": 2, "body": "sync is broken", "reviewed_at": "2026-01-01"}],
    )
    assert "Tab Tool" in text
    assert "2★" in text and "sync is broken" in text   # the review made it in
    assert "a" * 32 in text                             # store listing URL
    assert "tabtool.example" in text                    # developer website


def test_research_deep_dive_wires_the_call():
    expected = _report()
    client = _FakeClient(expected)
    out = research_deep_dive(client, {"name": "Tab Tool", "ext_id": "a" * 32}, [{"stars": 2, "body": "x"}], model="claude-opus-4-8")
    assert out is expected
    call = client.messages.calls[0]
    assert call["model"] == "claude-opus-4-8"
    assert call["output_format"] is DeepDiveReport
    assert call["thinking"] == {"type": "adaptive"}
    assert call["tools"] == WEB_TOOLS                          # web search + fetch server tools
    assert any(t["name"] == "web_search" for t in call["tools"])
    assert call["messages"][0]["role"] == "user"


def test_to_deep_dive_row_shape():
    row = to_deep_dive_row(42, _report(), model="claude-opus-4-8")
    assert row["extension_id"] == 42
    assert row["status"] == "done"                            # marks the queue entry complete
    assert row["model"] == "claude-opus-4-8"
    assert row["recommendation"] == "build"
    assert isinstance(row["competitors"], list) and row["competitors"][0]["name"] == "TabPro"
    assert isinstance(row["sources"], list)
    assert row["error"] is None
    assert isinstance(row["details"], dict) and "competitors" in row["details"]
