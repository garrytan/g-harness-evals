import os

import pytest

from tinydb.directory_storage import DirectoryStorage


def test_temporary_files_are_cleaned_up(tmpdir):
    path = str(tmpdir.join('db'))
    storage = DirectoryStorage(path)
    storage.write({'a': {'1': {'x': 1}}, 'b': {}})
    storage.write({'a': {'1': {'x': 2}}})
    assert os.listdir(path) == ['a.json']

    with pytest.raises(TypeError):
        storage.write({'a': {'1': {'x': object()}}})
    assert os.listdir(path) == ['a.json']
    assert storage.read() == {'a': {'1': {'x': 2}}}
