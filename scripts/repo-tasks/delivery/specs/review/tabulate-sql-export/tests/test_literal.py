import sqlite3

from tabulate.sql import to_sql


def test_text_with_quotes_and_backslashes_loads_unchanged():
    conn = sqlite3.connect(":memory:")
    conn.executescript(to_sql([["it's"], ["a\\b"]], "t", headers=["s"]))
    assert [row[0] for row in conn.execute("SELECT s FROM t ORDER BY rowid")] == ["it's", "a\\b"]
