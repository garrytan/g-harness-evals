from peewee import CharField
from peewee import Model
from peewee import SqliteDatabase
from playhouse.archive import Archive

db = SqliteDatabase(':memory:')


class Invoice(Model):
    number = CharField()

    class Meta:
        database = db


def test_archive_in_several_batches_moves_every_row():
    db.create_tables([Invoice])
    for i in range(5):
        Invoice.create(number='INV-%s' % i)

    archive = Archive(Invoice, batch_size=2)
    assert archive.archive() == 5
    assert Invoice.select().count() == 0
    assert archive.count() == 5
