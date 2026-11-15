from peewee import CharField
from peewee import Model
from peewee import SqliteDatabase
from playhouse.archive import Archive

db = SqliteDatabase(':memory:')


class Invoice(Model):
    number = CharField()

    class Meta:
        database = db


def test_archive_table_name_with_a_double_quote():
    db.create_tables([Invoice])
    for i in range(3):
        Invoice.create(number='INV-%s' % i)

    archive = Archive(Invoice, table_name='old "invoices"')
    assert archive.archive(Invoice.id < 3) == 2
    assert archive.count() == 2
    assert archive.restore([1]) == 1
    assert Invoice.select().count() == 2
