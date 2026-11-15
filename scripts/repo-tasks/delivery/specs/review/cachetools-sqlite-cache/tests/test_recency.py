from cachetools.sqlite import SQLiteCache


def test_reads_make_an_item_recently_used(tmp_path):
    cache = SQLiteCache(str(tmp_path / "cache.db"), 3)
    cache["a"] = 1
    cache["b"] = 2
    cache["c"] = 3
    assert cache["b"] == 2
    assert cache["a"] == 1
    cache["d"] = 4
    assert sorted(cache) == ["a", "b", "d"]
    cache.close()
