import os

import pytest

from tinydb.directory_storage import DirectoryStorage


def test_read_only_never_creates_the_directory(tmpdir):
    path = str(tmpdir.join('db'))
    with pytest.raises(FileNotFoundError):
        DirectoryStorage(path, read_only=True)
    assert not os.path.exists(path)
