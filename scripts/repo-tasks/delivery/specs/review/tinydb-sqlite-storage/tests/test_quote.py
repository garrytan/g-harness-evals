from tinydb.sqlite_storage import SQLiteStorage


def test_table_name_with_a_double_quote(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    storage = SQLiteStorage(path)
    data = {'odd"name': {'1': {'x': 1}}}
    storage.write(data)
    assert storage.read() == data
    storage.close()
