from peewee import CharField
from peewee import Model
from peewee import SqliteDatabase
from playhouse.archive import Archive

db = SqliteDatabase(':memory:')


class Invoice(Model):
    number = CharField()

    class Meta:
        database = db
        table_name = 'invoices'


def test_default_archive_name_follows_the_table_name():
    db.create_tables([Invoice])
    Invoice.create(number='INV-1')

    archive = Archive(Invoice)
    assert archive.archive() == 1
    assert sorted(db.get_tables()) == ['invoices', 'invoices_archive']
