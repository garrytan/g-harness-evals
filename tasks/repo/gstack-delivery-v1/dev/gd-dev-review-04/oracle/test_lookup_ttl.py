import cachetools
from cachetools.sqlite import SQLiteCache


def test_a_missing_key_is_missing_in_a_cache_with_ttl(tmp_path):
    cache = SQLiteCache(str(tmp_path / "cache.db"), 10, ttl=3600)
    cache["a"] = 1
    try:
        value = cache["b"]
    except KeyError:
        value = None
    assert value is None
    cache.close()


def test_cached_functions_with_ttl_get_their_own_results(tmp_path):
    cache = SQLiteCache(str(tmp_path / "cache.db"), 10, ttl=3600)

    @cachetools.cached(cache)
    def square(n):
        return n * n

    assert square(2) == 4
    assert square(3) == 9
    cache.close()
