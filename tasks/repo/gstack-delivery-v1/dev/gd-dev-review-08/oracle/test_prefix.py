from tinydb.sqlite_storage import SQLiteStorage


def test_underscore_prefix_does_not_match_other_tables(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    first = SQLiteStorage(path, prefix='a_')
    first.write({'t': {'1': {'x': 1}}})
    second = SQLiteStorage(path, prefix='ab')
    second.write({'u': {'1': {'y': 2}}})

    assert first.read() == {'t': {'1': {'x': 1}}}
    first.close()
    second.close()
