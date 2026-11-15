import pytest

from peewee import CharField
from peewee import ForeignKeyField
from peewee import IntegrityError
from peewee import Model
from peewee import SqliteDatabase
from playhouse.archive import Archive

db = SqliteDatabase(':memory:', pragmas={'foreign_keys': 1})


class Invoice(Model):
    number = CharField()

    class Meta:
        database = db


class Line(Model):
    invoice = ForeignKeyField(Invoice)

    class Meta:
        database = db


def test_a_batch_that_cannot_be_deleted_is_not_copied():
    db.create_tables([Invoice, Line])
    invoice = Invoice.create(number='INV-1')
    Line.create(invoice=invoice)

    archive = Archive(Invoice)
    with pytest.raises(IntegrityError):
        archive.archive()
    assert archive.count() == 0
    assert Invoice.select().count() == 1
