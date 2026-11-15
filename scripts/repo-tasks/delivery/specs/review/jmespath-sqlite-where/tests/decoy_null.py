import json
import sqlite3

import jmespath
from jmespath.sqlite import select


def test_a_missing_field_equals_null():
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE t (data TEXT)')
    docs = [{'nick': 'al'}, {'nick': None}, {}]
    conn.executemany('INSERT INTO t VALUES (?)', [(json.dumps(d),) for d in docs])
    for condition in ['nick == `null`', 'nick != `null`']:
        assert select(conn, 't', condition) == jmespath.search('[?' + condition + ']', docs)
    assert select(conn, 't', 'nick == `null`') == [{'nick': None}, {}]
