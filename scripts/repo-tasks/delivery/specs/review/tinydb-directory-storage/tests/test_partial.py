import pytest

from tinydb.directory_storage import DirectoryStorage


def test_failed_write_changes_no_file(tmpdir):
    path = str(tmpdir.join('db'))
    storage = DirectoryStorage(path)
    data = {'a': {'1': {'x': 1}}, 'b': {'1': {'y': 1}}}
    storage.write(data)

    with pytest.raises(TypeError):
        storage.write({'a': {'1': {'x': 2}}, 'b': {'1': {'y': object()}}})
    assert storage.read() == data
