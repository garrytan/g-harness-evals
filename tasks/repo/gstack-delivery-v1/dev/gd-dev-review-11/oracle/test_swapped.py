import json
import sqlite3

import jmespath
from jmespath.sqlite import select


def test_literal_on_the_left_of_an_ordering():
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE t (data TEXT)')
    docs = [{'n': 3}, {'n': 5}, {'n': 7}]
    conn.executemany('INSERT INTO t VALUES (?)', [(json.dumps(d),) for d in docs])
    for op in ['<', '<=', '>', '>=']:
        condition = '`5` %s n' % op
        assert select(conn, 't', condition) == jmespath.search('[?' + condition + ']', docs)
