from cachetools.sqlite import SQLiteCache


def test_table_name_with_a_double_quote(tmp_path):
    path = str(tmp_path / "cache.db")
    cache = SQLiteCache(path, 10, table='results "v2"')
    cache["k"] = 1
    assert cache["k"] == 1
    cache.close()
