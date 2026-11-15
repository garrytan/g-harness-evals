from peewee import CharField
from peewee import IntegerField
from peewee import Model
from peewee import SqliteDatabase
from playhouse.archive import Archive

db = SqliteDatabase(':memory:')


class Invoice(Model):
    number = CharField()
    total = IntegerField(null=True)

    class Meta:
        database = db


def test_archive_table_names_are_quoted():
    db.create_tables([Invoice])
    Invoice.create(number='INV-1', total=None)
    Invoice.create(number='INV-2', total=20)

    archive = Archive(Invoice, table_name='x; DROP TABLE invoice; --')
    assert archive.archive() == 2
    assert archive.count() == 2
    assert db.table_exists('invoice')
    assert archive.restore([1, 2]) == 2
    rows = list(Invoice.select().order_by(Invoice.id).tuples())
    assert rows == [(1, 'INV-1', None), (2, 'INV-2', 20)]
