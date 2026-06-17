from analysis.monetize import (
    MonetizationProfile,
    WEB_TOOLS,
    build_user_prompt,
    research_monetization,
    to_monetization_row,
)


def _profile(**kw):
    base = dict(
        pricing_model="freemium",
        makes_money=True,
        has_paid_tier=True,
        price_min_usd=4.0,
        price_max_usd=12.0,
        estimated_users=500_000,
        estimated_monthly_revenue_usd=20_000.0,
        revenue_low_usd=8_000.0,
        revenue_high_usd=40_000.0,
        confidence="medium",
        monetization_summary="Freemium with a $4-12/mo paid tier.",
        pricing_notes="Assumed 1% conversion of ~500k users.",
        sources=["https://example.com/pricing"],
    )
    base.update(kw)
    return MonetizationProfile(**base)


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


def test_build_user_prompt_includes_listing_and_metrics():
    text = build_user_prompt(
        {"name": "PDF Pro", "ext_id": "a" * 32, "install_count": 1_000_000,
         "rating": 4.2, "rating_count": 3000, "store_category": "Productivity / Tools",
         "website": "https://pdfpro.example"},
    )
    assert "PDF Pro" in text
    assert "1000000" in text
    assert "a" * 32 in text                      # store listing URL
    assert "pdfpro.example" in text              # developer website


def test_research_monetization_wires_the_call():
    expected = _profile()
    client = _FakeClient(expected)
    out = research_monetization(client, {"name": "PDF Pro", "ext_id": "a" * 32}, model="claude-opus-4-8")
    assert out is expected
    call = client.messages.calls[0]
    assert call["model"] == "claude-opus-4-8"
    assert call["output_format"] is MonetizationProfile
    assert call["thinking"] == {"type": "adaptive"}
    assert call["tools"] == WEB_TOOLS                       # web search + fetch server tools
    assert any(t["name"] == "web_search" for t in call["tools"])
    assert call["messages"][0]["role"] == "user"


def test_to_monetization_row_shape():
    row = to_monetization_row(42, _profile(), model="claude-opus-4-8")
    assert row["extension_id"] == 42
    assert row["model"] == "claude-opus-4-8"
    assert row["pricing_model"] == "freemium"
    assert row["estimated_monthly_revenue_usd"] == 20_000.0
    assert isinstance(row["sources"], list)
