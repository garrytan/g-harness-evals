import os

from tinydb.directory_storage import DirectoryStorage


def test_other_files_in_the_directory_are_left_alone(tmpdir):
    path = str(tmpdir.join('db'))
    os.makedirs(path)
    with open(os.path.join(path, 'notes.txt'), 'w') as handle:
        handle.write('not a table')

    storage = DirectoryStorage(path)
    storage.write({'t': {'1': {'x': 1}}})
    assert sorted(os.listdir(path)) == ['notes.txt', 't.json']
    assert storage.read() == {'t': {'1': {'x': 1}}}
