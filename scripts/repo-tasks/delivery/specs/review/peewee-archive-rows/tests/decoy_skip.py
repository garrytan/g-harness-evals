from peewee import CharField
from peewee import Model
from peewee import SqliteDatabase
from playhouse.archive import Archive

db = SqliteDatabase(':memory:')


class Invoice(Model):
    number = CharField()

    class Meta:
        database = db


def test_restore_leaves_rows_whose_key_is_taken():
    db.create_tables([Invoice])
    Invoice.create(number='INV-1')
    Invoice.create(number='INV-2')

    archive = Archive(Invoice)
    assert archive.archive() == 2
    Invoice.create(id=1, number='NEW-1')

    assert archive.restore([1, 2]) == 1
    assert archive.count() == 1
    rows = list(Invoice.select().order_by(Invoice.id).tuples())
    assert rows == [(1, 'NEW-1'), (2, 'INV-2')]
