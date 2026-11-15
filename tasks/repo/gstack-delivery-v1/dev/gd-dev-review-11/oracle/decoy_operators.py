import json
import sqlite3

import jmespath
from jmespath.sqlite import select


def test_every_operator_matches_search():
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE t (data TEXT)')
    docs = [{'n': 1, 's': 'a'}, {'n': 2, 's': 'b'}, {'n': 3, 's': 'c'}, {'n': 2.5}]
    conn.executemany('INSERT INTO t VALUES (?)', [(json.dumps(d),) for d in docs])
    for op in ['==', '!=', '<', '<=', '>', '>=']:
        for condition in ['n %s `2`' % op, "s %s 'b'" % op]:
            try:
                expected = jmespath.search('[?' + condition + ']', docs)
            except TypeError:
                continue
            assert select(conn, 't', condition) == expected, condition
