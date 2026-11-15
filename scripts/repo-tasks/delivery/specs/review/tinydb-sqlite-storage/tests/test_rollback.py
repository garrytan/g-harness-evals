import pytest

from tinydb.sqlite_storage import SQLiteStorage


def test_failed_write_changes_nothing(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    storage = SQLiteStorage(path)
    data = {'t': {'1': {'x': 1}}, 'u': {'1': {'y': 2}}}
    storage.write(data)

    with pytest.raises(TypeError):
        storage.write({'t': {'1': {'x': object()}}})

    assert storage.read() == data
    storage.close()
