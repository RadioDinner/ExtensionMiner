from common.db import select_zone_targets


def _c(id, installs):
    return {"id": id, "ext_id": f"e{id}", "install_count": installs}


def test_orders_by_installs_and_caps_to_limit():
    cands = [_c(1, 100), _c(2, 300), _c(3, 200)]
    out = select_zone_targets(cands, dismissed_ids=set(), legitimacy_by_id={}, limit=2)
    assert [c["id"] for c in out] == [2, 3]  # 300, 200 (the 100 is cut)


def test_drops_dismissed():
    cands = [_c(1, 100), _c(2, 300), _c(3, 200)]
    out = select_zone_targets(cands, dismissed_ids={2}, legitimacy_by_id={}, limit=10)
    assert [c["id"] for c in out] == [3, 1]  # 2 removed; rest by installs desc


def test_legitimacy_demotes_review_bombed():
    # ext 2 has the most installs but was review-bombed (legitimacy 0.1), so its
    # effective rank (300 * 0.1 = 30) sinks below ext 1 (100 * 1.0 = 100).
    cands = [_c(1, 100), _c(2, 300)]
    out = select_zone_targets(cands, dismissed_ids=set(), legitimacy_by_id={2: 0.1}, limit=10)
    assert [c["id"] for c in out] == [1, 2]


def test_missing_legitimacy_is_neutral():
    cands = [_c(1, 100), _c(2, 300)]
    out = select_zone_targets(cands, dismissed_ids=set(), legitimacy_by_id=None, limit=10)
    assert [c["id"] for c in out] == [2, 1]  # no legitimacy => pure install order


def test_handles_null_installs():
    cands = [_c(1, None), _c(2, 50)]
    out = select_zone_targets(cands, dismissed_ids=set(), legitimacy_by_id={}, limit=10)
    assert [c["id"] for c in out] == [2, 1]  # null installs treated as 0 (last)
