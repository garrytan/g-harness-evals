import math
import sqlite3

from tabulate.sql import to_sql


def test_nan_and_infinity_are_null():
    conn = sqlite3.connect(":memory:")
    conn.executescript(to_sql([[1.5], [math.nan], [math.inf]], "t", headers=["x"]))
    assert list(conn.execute("SELECT x FROM t ORDER BY rowid")) == [(1.5,), (None,), (None,)]
