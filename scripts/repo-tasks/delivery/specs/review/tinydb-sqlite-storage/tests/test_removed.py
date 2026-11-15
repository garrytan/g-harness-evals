from tinydb.sqlite_storage import SQLiteStorage


def test_removed_documents_stay_removed(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    storage = SQLiteStorage(path)
    storage.write({'t': {'1': {'x': 1}, '2': {'x': 2}}})
    storage.write({'t': {'1': {'x': 1}}})
    storage.close()

    storage = SQLiteStorage(path)
    assert storage.read() == {'t': {'1': {'x': 1}}}
    storage.close()
