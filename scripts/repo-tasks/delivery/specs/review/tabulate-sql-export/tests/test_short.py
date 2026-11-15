import sqlite3

from tabulate.sql import to_sql


def test_short_rows_get_null():
    conn = sqlite3.connect(":memory:")
    conn.executescript(to_sql([[1, "a"], [2]], "t", headers=["n", "s"]))
    assert list(conn.execute("SELECT n, s FROM t ORDER BY rowid")) == [(1, "a"), (2, None)]
