from tinydb.directory_storage import DirectoryStorage


def test_table_names_ending_in_suffix_letters(tmpdir):
    path = str(tmpdir.join('db'))
    storage = DirectoryStorage(path)
    data = {'session': {'1': {'x': 1}}, 'json': {'1': {'y': 2}}}
    storage.write(data)
    assert storage.read() == data
