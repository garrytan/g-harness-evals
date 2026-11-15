"""Tests of the SQL export."""

import sqlite3

from pytest import raises

from tabulate import SEPARATING_LINE
from tabulate.sql import to_sql, write_sql


def _load(script):
    conn = sqlite3.connect(":memory:")
    conn.executescript(script)
    return conn


def test_to_sql_output():
    "SQL: statements for a small table"
    script = to_sql([["spam", 41.5], ["eggs", 451]], "stock", headers=["item", "qty"])
    assert script == (
        'CREATE TABLE "stock" ("item" TEXT, "qty" REAL);\n'
        'INSERT INTO "stock" ("item", "qty") VALUES\n'
        "('spam', 41.5),\n"
        "('eggs', 451.0);\n"
    )


def test_column_types():
    "SQL: column types follow tabulate's column types"
    conn = _load(to_sql([[1, 2.5, "x"], [2, 3, "y"]], "t", headers=["i", "f", "s"]))
    info = [(row[1], row[2]) for row in conn.execute('PRAGMA table_info("t")')]
    assert info == [("i", "INTEGER"), ("f", "REAL"), ("s", "TEXT")]


def test_disable_numparse():
    "SQL: with disable_numparse, every column is text"
    conn = _load(to_sql([["007"], ["010"]], "t", headers=["zip"], disable_numparse=True))
    assert list(conn.execute("SELECT zip FROM t ORDER BY rowid")) == [("007",), ("010",)]


def test_round_trip():
    "SQL: values load back as given, None as NULL"
    rows = [["spam", 41, 1.5], ["eggs", None, 2.25]]
    conn = _load(to_sql(rows, "stock", headers=["item", "qty", "price"]))
    loaded = list(conn.execute("SELECT item, qty, price FROM stock ORDER BY rowid"))
    assert loaded == [("spam", 41, 1.5), ("eggs", None, 2.25)]


def test_list_of_dicts():
    "SQL: headers='keys' names the columns after the dict keys"
    conn = _load(to_sql([{"a": 1, "b": "x"}, {"a": 2, "b": "y"}], "t"))
    assert list(conn.execute("SELECT a, b FROM t ORDER BY rowid")) == [(1, "x"), (2, "y")]


def test_separating_lines_are_skipped():
    "SQL: separating lines are not rows"
    conn = _load(to_sql([[1], SEPARATING_LINE, [2]], "t", headers=["n"]))
    assert list(conn.execute("SELECT n FROM t ORDER BY rowid")) == [(1,), (2,)]


def test_replace():
    "SQL: replace=True drops the old table"
    conn = _load(to_sql([[1]], "t", headers=["n"]))
    conn.executescript(to_sql([[2], [3]], "t", headers=["n"], replace=True))
    assert list(conn.execute("SELECT n FROM t ORDER BY rowid")) == [(2,), (3,)]


def test_headers_are_required():
    "SQL: every column needs a header"
    with raises(ValueError):
        to_sql([[1, 2]], "t", headers=[])


def test_write_sql(tmp_path):
    "SQL: write_sql writes the statements to a file"
    path = tmp_path / "stock.sql"
    write_sql(str(path), [["spam", 41]], "stock", headers=["item", "qty"])
    conn = _load(path.read_text())
    assert list(conn.execute("SELECT item, qty FROM stock")) == [("spam", 41)]
