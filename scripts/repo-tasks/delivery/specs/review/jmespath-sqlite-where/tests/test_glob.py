import json
import sqlite3

from jmespath.sqlite import select


def test_starts_with_a_bracket():
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE t (data TEXT)')
    docs = [{'title': '[draft] notes'}, {'title': 'draft'}, {'title': 'todo'}]
    conn.executemany('INSERT INTO t VALUES (?)', [(json.dumps(d),) for d in docs])
    assert select(conn, 't', "starts_with(title, '[draft]')") == [{'title': '[draft] notes'}]
