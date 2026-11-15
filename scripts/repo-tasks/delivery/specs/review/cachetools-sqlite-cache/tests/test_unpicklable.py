import threading

import pytest

from cachetools.sqlite import SQLiteCache


def test_unpicklable_value_leaves_a_full_cache_alone(tmp_path):
    cache = SQLiteCache(str(tmp_path / "cache.db"), 2)
    cache["a"] = 1
    cache["b"] = 2
    with pytest.raises(TypeError):
        cache["c"] = threading.Lock()
    assert sorted(cache) == ["a", "b"]
    cache.close()
