from tinydb.sqlite_storage import SQLiteStorage


def test_documents_come_back_in_insertion_order(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    storage = SQLiteStorage(path)
    docs = {str(i): {'i': i} for i in range(1, 13)}
    storage.write({'t': docs})
    assert list(storage.read()['t']) == list(docs)
    storage.close()
