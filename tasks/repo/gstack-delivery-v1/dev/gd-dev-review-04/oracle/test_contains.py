from cachetools.sqlite import SQLiteCache


def test_membership_checks_do_not_count_as_use(tmp_path):
    cache = SQLiteCache(str(tmp_path / "cache.db"), 3)
    cache["a"] = 1
    cache["b"] = 2
    cache["c"] = 3
    for _ in range(5):
        assert "a" in cache
    cache["d"] = 4
    assert sorted(cache) == ["b", "c", "d"]
    cache.close()
