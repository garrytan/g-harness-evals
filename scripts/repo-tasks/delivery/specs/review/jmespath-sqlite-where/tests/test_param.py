import json
import sqlite3

from jmespath.sqlite import select


def test_field_names_with_a_single_quote():
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE t (data TEXT)')
    docs = [{"it's": 'yes'}, {"it's": 'no'}]
    conn.executemany('INSERT INTO t VALUES (?)', [(json.dumps(d),) for d in docs])
    assert select(conn, 't', '"it\'s" == \'yes\'') == [{"it's": 'yes'}]
