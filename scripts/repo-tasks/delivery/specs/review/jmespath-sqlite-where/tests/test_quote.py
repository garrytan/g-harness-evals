import json
import sqlite3

from jmespath.sqlite import select


def test_table_name_with_a_double_quote():
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE "my ""docs""" (data TEXT)')
    conn.execute('INSERT INTO "my ""docs""" VALUES (?)', (json.dumps({'n': 1}),))
    assert select(conn, 'my "docs"', "n == `1`") == [{'n': 1}]
