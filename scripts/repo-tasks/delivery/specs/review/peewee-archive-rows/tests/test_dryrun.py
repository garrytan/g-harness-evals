from peewee import CharField
from peewee import Model
from peewee import SqliteDatabase
from playhouse.archive import Archive

db = SqliteDatabase(':memory:')


class Invoice(Model):
    number = CharField()

    class Meta:
        database = db


def test_dry_run_changes_nothing():
    db.create_tables([Invoice])
    Invoice.create(number='INV-1')

    archive = Archive(Invoice)
    assert archive.archive(dry_run=True) == 1
    assert not db.table_exists(archive.table_name)
    assert db.get_tables() == ['invoice']
