import json
import os

import pytest

from tinydb import TinyDB, where
from tinydb.directory_storage import DirectoryStorage


def test_round_trip(tmpdir):
    path = str(tmpdir.join('db'))
    storage = DirectoryStorage(path)
    assert storage.read() is None

    data = {'_default': {'1': {'name': 'a'}}, 'people': {'1': {'age': 3}}}
    storage.write(data)
    assert sorted(os.listdir(path)) == ['_default.json', 'people.json']
    assert DirectoryStorage(path).read() == data


def test_with_tinydb(tmpdir):
    path = str(tmpdir.join('db'))
    with TinyDB(path, storage=DirectoryStorage) as db:
        db.insert({'int': 1, 'char': 'a'})
        db.table('people').insert({'name': 'Ann'})
        db.update({'char': 'b'}, where('int') == 1)

    with TinyDB(path, storage=DirectoryStorage) as db:
        assert db.tables() == {'_default', 'people'}
        assert db.all() == [{'int': 1, 'char': 'b'}]
        db.drop_table('people')

    assert os.listdir(path) == ['_default.json']


def test_unusual_table_names(tmpdir):
    path = str(tmpdir.join('db'))
    storage = DirectoryStorage(path)
    data = {'a b': {}, 'caf\u00e9': {'1': {'x': 1}}, '100%': {'1': {'y': 2}}}
    storage.write(data)
    assert storage.read() == data
    assert len(os.listdir(path)) == 3


def test_json_options(tmpdir):
    path = str(tmpdir.join('db'))
    storage = DirectoryStorage(path, sort_keys=True, indent=1)
    storage.write({'_default': {'1': {'b': 1, 'a': 2}}})
    with open(os.path.join(path, '_default.json')) as handle:
        text = handle.read()
    assert text == json.dumps({'1': {'a': 2, 'b': 1}}, indent=1)


def test_missing_directory(tmpdir):
    path = str(tmpdir.join('db'))
    with pytest.raises(FileNotFoundError):
        DirectoryStorage(path, create_dirs=False)
    assert not os.path.exists(path)


def test_read_only(tmpdir):
    path = str(tmpdir.join('db'))
    DirectoryStorage(path).write({'_default': {'1': {'x': 1}}})

    storage = DirectoryStorage(path, read_only=True)
    assert storage.read() == {'_default': {'1': {'x': 1}}}
    with pytest.raises(IOError):
        storage.write({})
    assert os.listdir(path) == ['_default.json']
