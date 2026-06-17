from datetime import date

import pytest

from scraper import parse


@pytest.mark.parametrize(
    "text,expected",
    [
        ("10,000+ users", 10000),
        ("1,000,000+ users", 1_000_000),
        ("100+ users", 100),
        ("1.2M users", 1_200_000),
        ("5K+ users", 5000),
        ("no number here", None),
        (None, None),
    ],
)
def test_parse_install_count(text, expected):
    assert parse.parse_install_count(text) == expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Rated 4.2 out of 5", 4.2),
        ("4.2", 4.2),
        ("5 out of 5", 5.0),
        ("nonsense", None),
        ("9", None),  # out of range
    ],
)
def test_parse_rating(text, expected):
    assert parse.parse_rating(text) == expected


@pytest.mark.parametrize(
    "text,expected",
    [("1.2K ratings", 1200), ("3,456 ratings", 3456), ("12 reviews", 12), ("", None)],
)
def test_parse_rating_count(text, expected):
    assert parse.parse_rating_count(text) == expected


@pytest.mark.parametrize(
    "text,expected",
    [("Rated 3 out of 5 stars", 3), ("Rated 4.6 out of 5", 5), ("2 stars", 2), ("", None)],
)
def test_parse_star_label(text, expected):
    assert parse.parse_star_label(text) == expected


def test_parse_version():
    assert parse.parse_version("Version 3.1.0") == "3.1.0"
    assert parse.parse_version("Version: 2024.5.1-beta") == "2024.5.1-beta"
    assert parse.parse_version("no version") is None


def test_parse_date_absolute():
    assert parse.parse_date("Updated September 5, 2024") == date(2024, 9, 5)
    assert parse.parse_date("Sep 5, 2024") == date(2024, 9, 5)


def test_parse_date_relative():
    today = date(2024, 1, 31)
    assert parse.parse_date("2 weeks ago", today=today) == date(2024, 1, 17)
    assert parse.parse_date("1 day ago", today=today) == date(2024, 1, 30)


def test_extract_extension_ids():
    ext = "a" * 32
    other = "b" * 32
    html = (
        f'<a href="/detail/tab-manager/{ext}">x</a>'
        f'<a href="/detail/tab-manager/{ext}">dup</a>'
        f'<a href="/detail/{other}">bare</a>'
        '<a href="/detail/short/abc">nope</a>'
    )
    assert parse.extract_extension_ids(html) == [ext, other]


def test_url_builders():
    ext = "c" * 32
    assert parse.detail_url(ext).endswith(f"/detail/x/{ext}")
    assert parse.category_url("productivity").endswith("/category/extensions/productivity")


def test_extract_category_slugs():
    html = (
        '<a href="/category/extensions/productivity">P</a>'
        '<a href="/category/extensions/productivity">dup</a>'
        '<a href="/category/extensions/make_chrome_yours/accessibility">A</a>'
        '<a href="/category/extensions/productivity/tools">sub</a>'
        '<a href="/category/ext/old">old store, ignored</a>'
        f'<a href="/detail/x/{"a" * 32}">not a category</a>'
    )
    assert parse.extract_category_slugs(html) == [
        "productivity",
        "make_chrome_yours/accessibility",
        "productivity/tools",
    ]
    assert parse.extract_category_slugs("") == []


DETAIL_HTML = """
<html><body>
  <h1>Tab Manager Pro</h1>
  <a href="https://example.com">Website</a>
  <a href="https://support.example.com">Support</a>
  <a href="https://example.com/privacy">Privacy policy</a>
  <img src="https://example.com/icon.png">
  <section>Overview: manage your tabs efficiently.</section>
</body></html>
"""

DETAIL_TEXT = (
    "Tab Manager Pro\n"
    "offered by Acme Labs\n"
    "4.2 out of 5\n"
    "1,234 ratings\n"
    "50,000+ users\n"
    "Version 3.1.0\n"
    "Updated Sep 5, 2024\n"
)


def test_parse_detail():
    ext_id = "d" * 32
    ext = parse.parse_detail(DETAIL_HTML, ext_id, page_text=DETAIL_TEXT)
    assert ext.ext_id == ext_id
    assert ext.name == "Tab Manager Pro"
    assert ext.developer == "Acme Labs"
    assert ext.rating == 4.2
    assert ext.rating_count == 1234
    assert ext.install_count == 50000
    assert ext.install_count_raw == "50,000+ users"
    assert ext.version == "3.1.0"
    assert ext.last_updated == date(2024, 9, 5)
    assert ext.website == "https://example.com"
    assert ext.support_url == "https://support.example.com"
    assert ext.privacy_url == "https://example.com/privacy"
    assert ext.icon_url == "https://example.com/icon.png"
    assert ext.listing_url.endswith(ext_id)


# Real-store-shaped visible text (chromewebstore.google.com), where the
# description lives under an "Overview" heading and the publisher is shown both
# under the title and in a "Developer" Details row.
REAL_DETAIL_HTML = "<html><body><h1>Wordtune: AI Grammar Tool</h1></body></html>"
REAL_DETAIL_TEXT = (
    "Install Chrome\n"
    "Wordtune: AI Grammar Tool\n"
    "AI21 LABS, INC.\n"
    "Featured\n"
    "4.6\n"
    "( 2.4K ratings )\n"
    "1,000,000 users\n"
    "Add to Chrome\n"
    "Overview\n"
    "Paraphrase, rewrite, and fix grammar for free. "
    "Wordtune is your AI writing companion.\n"
    "See more\n"
    "4.6 out of 5\n"
    "Details\n"
    "Version\n9.20.0\n"
    "Updated\nApril 19, 2026\n"
    "Developer\nAI21 LABS, INC.\n"
)


def test_parse_detail_real_store():
    ext = parse.parse_detail(REAL_DETAIL_HTML, "e" * 32, page_text=REAL_DETAIL_TEXT)
    assert ext.developer == "AI21 LABS, INC."
    assert ext.description.startswith("Paraphrase, rewrite, and fix grammar")
    assert "See more" not in ext.description
    assert ext.summary == "Paraphrase, rewrite, and fix grammar for free."


def test_extract_developer_falls_back_to_title_line():
    # Details block leads with a "Website" field (no company name) -> use the
    # publisher line shown under the title instead.
    text = (
        "Install Chrome\nJetwriter AI\njetwriter.ai\nFeatured\n4.6\n"
        "Overview\nWrite emails with AI.\nSee more\n"
        "Details\nDeveloper\nWebsite\nhttps://jetwriter.ai\n"
    )
    assert parse.extract_developer(text, "Jetwriter AI") == "jetwriter.ai"


REVIEWS_HTML = """
<ul>
  <li data-review-id="r1">
    <h4>Alice</h4>
    <div aria-label="Rated 2 out of 5 stars"></div>
    <time data-review-date="">Sep 5, 2024</time>
    <p data-review-text="">If sync worked I would pay for this.</p>
  </li>
  <li data-review-id="r2">
    <h4>Bob</h4>
    <div aria-label="Rated 5 out of 5"></div>
    <time>Jan 2, 2025</time>
    <p>Love it.</p>
  </li>
</ul>
"""


def test_parse_reviews():
    reviews = parse.parse_reviews(REVIEWS_HTML)
    assert len(reviews) == 2
    alice = reviews[0]
    assert alice.author == "Alice"
    assert alice.stars == 2
    assert alice.review_uid == "r1"
    assert "would pay" in alice.body
    assert alice.reviewed_at == date(2024, 9, 5)
    assert reviews[1].stars == 5
    assert reviews[1].author == "Bob"


# Real reviews-page shape (chromewebstore.google.com): one section.T7rvce per
# review; the first card embeds a developer reply that must NOT be captured.
REAL_REVIEWS_HTML = """
<main>
  <section class="T7rvce" data-review-id="rv1">
    <div class="U47jjf"><h3 class="PCeALe">
      <span class="LfYwpe">Rayyan Yousaf</span>
      <span class="ydlbEf">May 20, 2026</span>
    </h3><div aria-label="1 out of 5 stars"></div></div>
    <div class="fzDEpf">What a joke of an extension, everything is paywalled.</div>
    <div class="fPNqW">Ela Tumang Developer May 21, 2026 Hi Rayyan, we hear you...</div>
  </section>
  <section class="T7rvce" data-review-id="rv2">
    <div class="U47jjf"><h3 class="PCeALe">
      <span class="LfYwpe">Dr. Ali</span>
      <span class="ydlbEf">Apr 24, 2026</span>
    </h3><div aria-label="5 out of 5 stars"></div></div>
    <div class="fzDEpf">Great for research writing.</div>
  </section>
</main>
"""


def test_parse_reviews_real_store():
    reviews = parse.parse_reviews(REAL_REVIEWS_HTML)
    assert len(reviews) == 2
    r0 = reviews[0]
    assert r0.author == "Rayyan Yousaf"
    assert r0.stars == 1
    assert r0.review_uid == "rv1"
    assert r0.reviewed_at == date(2026, 5, 20)
    assert "joke of an extension" in r0.body
    # the nested developer reply must be excluded from the review body
    assert "Developer" not in r0.body
    assert "Ela Tumang" not in r0.body
    assert reviews[1].author == "Dr. Ali"
    assert reviews[1].stars == 5
