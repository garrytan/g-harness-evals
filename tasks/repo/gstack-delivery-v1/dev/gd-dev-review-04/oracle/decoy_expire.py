from cachetools.sqlite import SQLiteCache


def test_expire_with_and_without_a_time(tmp_path):
    now = [100.0]
    cache = SQLiteCache(str(tmp_path / "cache.db"), 10, ttl=5, timer=lambda: now[0])
    cache["a"] = 1
    now[0] = 103.0
    cache["b"] = 2
    cache.expire(106.0)
    assert list(cache) == ["b"]
    now[0] = 109.0
    cache.expire()
    assert list(cache) == []
    cache.close()
