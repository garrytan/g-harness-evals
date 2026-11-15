from cachetools.sqlite import SQLiteCache


def test_replacing_a_value_in_a_full_cache_evicts_nothing(tmp_path):
    cache = SQLiteCache(str(tmp_path / "cache.db"), 2)
    cache["a"] = 1
    cache["b"] = 2
    cache["a"] = 3
    assert sorted(cache) == ["a", "b"]
    cache.close()
