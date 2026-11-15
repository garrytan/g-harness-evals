from peewee import BooleanField
from peewee import CharField
from peewee import IntegerField
from playhouse.archive import Archive

from .base import ModelTestCase
from .base import TestModel


class Invoice(TestModel):
    number = CharField()
    total = IntegerField()
    paid = BooleanField(default=False)


class TestArchive(ModelTestCase):
    requires = [Invoice]

    def setUp(self):
        super(TestArchive, self).setUp()
        self.database.execute_sql('DROP TABLE IF EXISTS invoice_archive')
        for i in range(1, 6):
            Invoice.create(number='INV-%s' % i, total=i * 10, paid=i < 4)

    def tearDown(self):
        self.database.execute_sql('DROP TABLE IF EXISTS invoice_archive')
        super(TestArchive, self).tearDown()

    def numbers(self):
        query = Invoice.select().order_by(Invoice.id)
        return [invoice.number for invoice in query]

    def test_archive_and_restore(self):
        archive = Archive(Invoice)
        self.assertEqual(archive.count(), 0)
        self.assertEqual(archive.archive(Invoice.paid == True), 3)
        self.assertEqual(self.numbers(), ['INV-4', 'INV-5'])
        self.assertEqual(archive.count(), 3)

        self.assertEqual(archive.restore([1, 3]), 2)
        self.assertEqual(self.numbers(), ['INV-1', 'INV-3', 'INV-4', 'INV-5'])
        self.assertEqual(archive.count(), 1)

        invoice = Invoice.get(Invoice.id == 3)
        self.assertEqual((invoice.total, invoice.paid), (30, True))

    def test_archive_everything(self):
        archive = Archive(Invoice)
        self.assertEqual(archive.archive(), 5)
        self.assertEqual(self.numbers(), [])
        self.assertEqual(archive.archive(), 0)
        self.assertEqual(archive.restore(range(1, 6)), 5)
        self.assertEqual(len(self.numbers()), 5)

    def test_dry_run(self):
        archive = Archive(Invoice)
        self.assertEqual(archive.archive(Invoice.total > 20, dry_run=True), 3)
        self.assertEqual(len(self.numbers()), 5)
        self.assertEqual(archive.count(), 0)

    def test_restore_nothing(self):
        archive = Archive(Invoice)
        self.assertEqual(archive.restore([1, 2]), 0)
        self.assertEqual(archive.restore([]), 0)

    def test_options(self):
        archive = Archive(Invoice, table_name='old_invoices', batch_size=10)
        self.assertEqual(archive.table_name, 'old_invoices')
        try:
            self.assertEqual(archive.archive(Invoice.id == 2), 1)
            self.assertTrue(self.database.table_exists('old_invoices'))
            self.assertEqual(self.numbers(), ['INV-1', 'INV-3', 'INV-4',
                                              'INV-5'])
        finally:
            self.database.execute_sql('DROP TABLE IF EXISTS old_invoices')

        self.assertRaises(ValueError, Archive, Invoice, batch_size=0)
