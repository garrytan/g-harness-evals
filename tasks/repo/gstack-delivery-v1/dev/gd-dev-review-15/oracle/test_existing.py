import sqlite3

import pytest

from tabulate.sql import to_sql


def test_an_existing_table_is_left_alone_without_replace():
    conn = sqlite3.connect(":memory:")
    conn.execute('CREATE TABLE "t" ("a" INTEGER)')
    conn.execute('INSERT INTO "t" VALUES (1)')
    conn.commit()
    with pytest.raises(sqlite3.OperationalError):
        conn.executescript(to_sql([[2]], "t", headers=["a"]))
    assert [row[0] for row in conn.execute('SELECT "a" FROM "t"')] == [1]
