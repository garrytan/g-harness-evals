from tinydb.sqlite_storage import SQLiteStorage


def test_dropping_tables_with_unusual_names(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    storage = SQLiteStorage(path)
    storage.write({'a b; DROP TABLE x': {'1': {'v': 1}}, 'keep': {'1': {'v': 2}}})
    storage.write({'keep': {'1': {'v': 2}}})
    assert storage.read() == {'keep': {'1': {'v': 2}}}
    storage.close()
