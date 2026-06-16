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
