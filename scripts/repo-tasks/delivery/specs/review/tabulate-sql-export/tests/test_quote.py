import sqlite3

from tabulate.sql import to_sql


def test_column_name_with_double_quotes():
    conn = sqlite3.connect(":memory:")
    conn.executescript(to_sql([[1]], "t", headers=['say "hi"']))
    assert [row[1] for row in conn.execute('PRAGMA table_info("t")')] == ['say "hi"']
