import json
import sqlite3

from jmespath.sqlite import select


def test_comparing_with_true():
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE t (data TEXT)')
    docs = [{'on': True}, {'on': 1}, {'on': False}]
    conn.executemany('INSERT INTO t VALUES (?)', [(json.dumps(d),) for d in docs])
    assert [json.dumps(d) for d in select(conn, 't', 'on == `true`')] == ['{"on": true}']
