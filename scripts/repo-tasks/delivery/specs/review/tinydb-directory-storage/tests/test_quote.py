import os

from tinydb.directory_storage import DirectoryStorage


def test_table_files_stay_inside_the_directory(tmpdir):
    path = str(tmpdir.join('db'))
    storage = DirectoryStorage(path)
    data = {'../outside': {'1': {'x': 1}}}
    storage.write(data)
    assert os.listdir(str(tmpdir)) == ['db']
    assert len(os.listdir(path)) == 1
