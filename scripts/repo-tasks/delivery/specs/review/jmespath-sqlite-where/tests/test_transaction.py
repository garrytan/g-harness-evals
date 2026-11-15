import json
import sqlite3

from jmespath.sqlite import select


def test_select_leaves_the_callers_transaction_open(tmp_path):
    conn = sqlite3.connect(str(tmp_path / 'db.sqlite'))
    conn.execute('CREATE TABLE t (data TEXT)')
    conn.execute('INSERT INTO t VALUES (?)', (json.dumps({'n': 1}),))
    conn.commit()
    conn.execute('INSERT INTO t VALUES (?)', (json.dumps({'n': 2}),))
    assert select(conn, 't', 'n > `0`') == [{'n': 1}, {'n': 2}]
    conn.rollback()
    assert select(conn, 't', 'n > `0`') == [{'n': 1}]
    conn.close()
