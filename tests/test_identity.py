from scraper import identity


def test_normalize_names_and_urls():
    assert identity._normalize("Save to Pinterest") == "save to pinterest"
    assert identity._normalize("  SAVE  to  pinterest ") == "save to pinterest"
    # URLs collapse to host, ignoring scheme/www/trailing path
    assert identity._normalize("https://www.Pinterest.com/") == "pinterest com"
    assert identity._normalize("http://pinterest.com/install?x=1") == "pinterest com"
    assert identity._normalize(None) == ""


def test_matching_points_counts_shared_fields():
    a = {"name": "Save to Pinterest", "developer": "Pinterest", "website": "https://pinterest.com"}
    b = {"name": "Pinterest Saver", "developer": "Pinterest", "website": "http://www.pinterest.com/"}
    # name genuinely differs; developer + website agree (across URL formatting)
    assert set(identity.matching_points(a, b)) == {"developer", "website"}


def test_punctuation_and_case_are_ignored_in_names():
    a = {"name": "Save to Pinterest"}
    b = {"name": "  save to PINTEREST! "}
    assert identity.matching_points(a, b) == ["name"]


def test_missing_fields_never_match():
    a = {"name": "Foo", "developer": None, "website": ""}
    b = {"name": "Foo", "developer": None, "website": ""}
    assert identity.matching_points(a, b) == ["name"]  # only the present field counts


def test_same_ext_id_is_decisive_even_if_name_changed():
    a = {"ext_id": "x" * 32, "name": "New Name", "developer": "D", "website": "w"}
    b = {"ext_id": "x" * 32, "name": "Old Name", "developer": "Z", "website": "q"}
    assert identity.is_same_extension(a, b) is True


def test_same_product_under_new_id_via_two_points():
    # The user's scenario: name changed, but developer + website still match.
    a = {"ext_id": "a" * 32, "name": "Save to Pinterest", "developer": "Pinterest", "website": "pinterest.com"}
    b = {"ext_id": "b" * 32, "name": "Pinterest Saver", "developer": "Pinterest", "website": "https://pinterest.com"}
    assert identity.is_same_extension(a, b) is True
    # one point alone is not enough
    c = {"ext_id": "c" * 32, "name": "Save to Pinterest", "developer": "Someone Else", "website": "other.com"}
    assert identity.is_same_extension(a, c) is False


def test_find_successor_match_picks_best_different_id():
    candidate = {"ext_id": "new", "name": "Save to Pinterest", "developer": "Pinterest", "website": "pinterest.com"}
    existing = [
        {"ext_id": "new", "name": "Save to Pinterest", "developer": "Pinterest", "website": "pinterest.com"},  # same id: skip
        {"ext_id": "weak", "name": "Save to Pinterest", "developer": "X", "website": "y"},                      # 1 pt
        {"ext_id": "strong", "name": "Pinterest Saver", "developer": "Pinterest", "website": "pinterest.com"},  # 2 pts
    ]
    row, hits = identity.find_successor_match(candidate, existing)
    assert row["ext_id"] == "strong"
    assert set(hits) == {"developer", "website"}

    # nothing strong enough -> no match
    row2, hits2 = identity.find_successor_match(candidate, existing[:2])
    assert row2 is None and hits2 == []
