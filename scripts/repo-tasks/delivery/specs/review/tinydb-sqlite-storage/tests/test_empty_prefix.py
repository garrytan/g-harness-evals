import pytest
from tinydb import TinyDB

from tinydb.sqlite_storage import SQLiteStorage


def test_an_empty_prefix_is_refused(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    other = TinyDB(path, storage=SQLiteStorage, prefix='other_')
    other.insert({'keep': 1})
    other.close()

    try:
        storage = SQLiteStorage(path, prefix='')
    except ValueError:
        storage = None
    if storage is not None:
        storage.write({'mine': {'1': {'x': 1}}})
        storage.close()

    other = TinyDB(path, storage=SQLiteStorage, prefix='other_')
    assert other.all() == [{'keep': 1}]
    other.close()
    assert storage is None
