from cachetools.sqlite import SQLiteCache


def test_table_names_are_not_sql(tmp_path):
    path = str(tmp_path / "cache.db")
    odd = SQLiteCache(path, 10, table="x; DROP TABLE cache; --")
    plain = SQLiteCache(path, 10)
    plain["k"] = "plain"
    odd["k"] = "odd"
    odd.clear()
    assert plain["k"] == "plain"
    assert len(odd) == 0
    odd.close()
    plain.close()
