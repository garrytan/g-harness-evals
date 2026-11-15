from tinydb import TinyDB, where
from tinydb.sqlite_storage import SQLiteStorage


def test_round_trip(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    storage = SQLiteStorage(path)
    assert storage.read() is None
    data = {'_default': {'1': {'name': 'a'}, '2': {'name': 'b'}}}
    storage.write(data)
    storage.close()

    storage = SQLiteStorage(path)
    assert storage.read() == data
    storage.close()


def test_with_tinydb(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    with TinyDB(path, storage=SQLiteStorage) as db:
        db.insert({'int': 1, 'char': 'a'})
        db.insert({'int': 2, 'char': 'b'})
        db.update({'char': 'c'}, where('int') == 2)

    with TinyDB(path, storage=SQLiteStorage) as db:
        assert db.search(where('char') == 'c') == [{'int': 2, 'char': 'c'}]
        assert len(db) == 2


def test_prefixes_share_a_file(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    with TinyDB(path, storage=SQLiteStorage, prefix='one') as one:
        one.insert({'x': 1})
    with TinyDB(path, storage=SQLiteStorage, prefix='two') as two:
        two.insert({'x': 2})

    with TinyDB(path, storage=SQLiteStorage, prefix='one') as one:
        assert one.all() == [{'x': 1}]
    with TinyDB(path, storage=SQLiteStorage, prefix='two') as two:
        assert two.all() == [{'x': 2}]


def test_tables(tmp_path):
    path = str(tmp_path / 'db.sqlite')
    with TinyDB(path, storage=SQLiteStorage) as db:
        db.table('users').insert({'name': 'x'})
        db.table('orders').insert({'total': 3})

    with TinyDB(path, storage=SQLiteStorage) as db:
        assert db.tables() == {'users', 'orders'}
        assert db.table('orders').all() == [{'total': 3}]
