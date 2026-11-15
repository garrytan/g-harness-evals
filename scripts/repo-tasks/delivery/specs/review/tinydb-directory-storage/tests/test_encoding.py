import os

import pytest

from tinydb.directory_storage import DirectoryStorage


def test_a_write_the_encoding_cannot_hold_leaves_no_file_behind(tmpdir):
    path = str(tmpdir.join('db'))
    storage = DirectoryStorage(path, encoding='ascii', ensure_ascii=False)
    storage.write({'a': {'1': {'x': 'plain'}}})
    with pytest.raises(UnicodeEncodeError):
        storage.write({'a': {'1': {'x': 'caf\u00e9'}}})
    assert os.listdir(path) == ['a.json']
    assert storage.read() == {'a': {'1': {'x': 'plain'}}}
