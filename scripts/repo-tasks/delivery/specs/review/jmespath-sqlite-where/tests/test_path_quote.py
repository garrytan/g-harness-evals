import json
import sqlite3

import jmespath
from jmespath.sqlite import UnsupportedExpressionError, select


def test_a_double_quote_in_a_dotted_path():
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE t (data TEXT)')
    docs = [{'team': {'a': {'b': 'yes'}}}, {'team': {'a".b': 'yes'}}]
    conn.executemany('INSERT INTO t VALUES (?)', [(json.dumps(d),) for d in docs])
    condition = 'team."a\\".\\"b" == \'yes\''
    try:
        found = select(conn, 't', condition)
    except UnsupportedExpressionError:
        return
    assert found == jmespath.search('[?' + condition + ']', docs)
