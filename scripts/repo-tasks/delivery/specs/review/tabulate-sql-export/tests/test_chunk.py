import sqlite3

from tabulate.sql import to_sql


def test_every_row_of_a_large_table_is_inserted():
    conn = sqlite3.connect(":memory:")
    conn.executescript(to_sql([[i] for i in range(1200)], "t", headers=["n"]))
    assert conn.execute("SELECT count(*), sum(n) FROM t").fetchone() == (1200, sum(range(1200)))
