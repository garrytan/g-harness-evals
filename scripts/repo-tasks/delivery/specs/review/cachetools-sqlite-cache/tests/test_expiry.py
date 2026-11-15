from cachetools.sqlite import SQLiteCache


def test_item_is_gone_exactly_ttl_seconds_after_it_was_stored(tmp_path):
    now = [0]
    cache = SQLiteCache(str(tmp_path / "cache.db"), 10, ttl=10, timer=lambda: now[0])
    cache["k"] = 1
    now[0] = 9
    assert cache["k"] == 1
    now[0] = 10
    try:
        value = cache["k"]
    except KeyError:
        value = None
    assert value is None
    cache.close()
