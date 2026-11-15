import sqlite3

from tabulate.sql import to_sql


def test_keywords_and_spaces_in_names():
    conn = sqlite3.connect(":memory:")
    conn.executescript(to_sql([[1, 2]], "order items", headers=["select", "from"]))
    assert list(conn.execute('SELECT "select", "from" FROM "order items"')) == [(1, 2)]
