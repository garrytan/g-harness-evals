from peewee import CharField
from peewee import Model
from peewee import SqliteDatabase
from playhouse.archive import Archive

db = SqliteDatabase(':memory:')


class Invoice(Model):
    number = CharField()

    class Meta:
        database = db


def test_count_changes_nothing():
    db.create_tables([Invoice])
    Invoice.create(number='INV-1')

    archive = Archive(Invoice)
    assert archive.count() == 0
    assert db.get_tables() == ['invoice']
    assert Invoice.select().count() == 1
