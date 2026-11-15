import pytest

from tinydb.sqlite_storage import SQLiteStorage


def test_readonly_never_changes_the_file(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    storage = SQLiteStorage(path)
    storage.write({'t': {'1': {'x': 1}}})
    storage.close()

    readonly = SQLiteStorage(path, readonly=True)
    assert readonly.read() == {'t': {'1': {'x': 1}}}
    with pytest.raises(Exception):
        readonly.write({'t': {}})
    readonly.close()

    storage = SQLiteStorage(path)
    assert storage.read() == {'t': {'1': {'x': 1}}}
    storage.close()
