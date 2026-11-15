import os

from tinydb.directory_storage import DirectoryStorage


def test_write_works_where_directories_cannot_be_synced(tmpdir, monkeypatch):
    path = str(tmpdir.join('db'))
    storage = DirectoryStorage(path)
    real_open = os.open

    def no_directories(file, *args, **kwargs):
        if os.path.isdir(file):
            raise PermissionError(file)
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(os, 'open', no_directories)
    storage.write({'a': {'1': {'x': 1}}})
    monkeypatch.undo()
    assert DirectoryStorage(path).read() == {'a': {'1': {'x': 1}}}
