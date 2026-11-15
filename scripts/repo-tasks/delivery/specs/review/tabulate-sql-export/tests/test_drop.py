import sqlite3

from tabulate.sql import to_sql


def test_replace_a_table_whose_name_has_a_space():
    conn = sqlite3.connect(":memory:")
    conn.executescript(to_sql([[1]], "my table", headers=["n"]))
    conn.executescript(to_sql([[2]], "my table", headers=["n"], replace=True))
    assert list(conn.execute('SELECT n FROM "my table"')) == [(2,)]
