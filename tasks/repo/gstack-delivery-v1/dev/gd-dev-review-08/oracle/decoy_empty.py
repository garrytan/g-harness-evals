from tinydb import TinyDB
from tinydb.sqlite_storage import SQLiteStorage


def test_a_new_file_reads_as_empty_storage(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    storage = SQLiteStorage(path)
    assert storage.read() is None
    storage.close()

    with TinyDB(path, storage=SQLiteStorage) as db:
        db.insert({'a': 1})
        assert db.all() == [{'a': 1}]
