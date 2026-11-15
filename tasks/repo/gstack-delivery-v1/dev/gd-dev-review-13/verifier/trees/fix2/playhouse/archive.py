"""
Move rows that are no longer needed out of a table and into an archive table,
and back again.

The archive table has the columns of the model's table. Rows move in batches,
and each batch is copied and deleted in one transaction, so a row is always in
exactly one of the two tables.

Example::

    from playhouse.archive import Archive

    archive = Archive(Order, batch_size=500)
    archive.archive(Order.created < cutoff)
    archive.restore([10, 11])
"""


class Archive(object):
    """
    Archive the rows of a model.

    :param model: a model with a single-column primary key.
    :param str table_name: name of the archive table. Defaults to the table
        name of the model followed by ``_archive``.
    :param int batch_size: the most rows moved in one transaction.
    """
    def __init__(self, model, table_name=None, batch_size=100):
        if not model._meta.primary_key or model._meta.composite_key:
            raise ValueError('%s needs a single-column primary key.' %
                             model.__name__)
        if batch_size < 1:
            raise ValueError('batch_size must be at least 1.')

        self.model = model
        self.database = model._meta.database
        self.table_name = table_name or model.__name__.lower() + '_archive'
        self.batch_size = batch_size

    def create_table(self):
        """
        Create the archive table, with the columns of the model's table,
        unless it already exists.
        """
        self.database.execute_sql(
            'CREATE TABLE IF NOT EXISTS %s AS SELECT * FROM %s LIMIT 0' % (
                self._quote(self.table_name),
                self._quote(self.model._meta.table_name)))

    def _quote(self, name):
        start, end = self.database.quote
        return start + name.replace(end, '\\' + end) + end

    def archive(self, where=None, dry_run=False):
        """
        Move the rows that match ``where`` (every row when it is None) to the
        archive table, and return how many were moved.

        :param where: an expression on the model's fields.
        :param bool dry_run: only count the rows that would be moved, and
            change nothing.
        """
        pk = self.model._meta.primary_key
        query = self.model.select(pk).order_by(pk).tuples()
        if where is not None:
            query = query.where(where)
        if dry_run:
            return query.count()

        self.create_table()
        return self._archive_batches(query)

    def _archive_batches(self, query):
        """
        Move the rows the query selects, one batch per transaction, until it
        selects none.
        """
        pk = self.model._meta.primary_key
        moved = 0
        while True:
            batch = query.limit(self.batch_size).offset(moved)
            ids = [pk.db_value(row[0]) for row in batch]
            if not ids:
                break

            moved += self._move(ids, self.model._meta.table_name,
                                self.table_name)
            if len(ids) < self.batch_size:
                break
        return moved

    def restore(self, ids):
        """
        Move the archived rows with the given primary keys back to the model's
        table, and return how many were moved. A row whose primary key is
        already in the model's table again stays in the archive.

        :param ids: primary key values.
        """
        pk = self.model._meta.primary_key
        ids = [pk.db_value(i) for i in ids]
        if not ids or not self.database.table_exists(self.table_name):
            return 0

        query = self.model.select(pk).where(pk.in_(ids)).tuples()
        present = set(pk.db_value(row[0]) for row in query)
        wanted = [i for i in ids if i not in present]

        restored = 0
        for start in range(0, len(wanted), self.batch_size):
            restored += self._move(wanted[start:start + self.batch_size],
                                   self.table_name,
                                   self.model._meta.table_name)
        return restored

    def _move(self, ids, source, target):
        """
        Copy the rows with the given primary keys from one table to the other,
        then delete them from the first, in one transaction.
        """
        column = self._quote(self.model._meta.primary_key.column_name)
        where = '%s IN (%s)' % (
            column, ', '.join([self.database.param] * len(ids)))

        with self.database.atomic():
            cursor = self.database.execute_sql(
                'INSERT INTO %s SELECT * FROM %s WHERE %s' % (
                    self._quote(target), self._quote(source), where),
                ids)
            self.database.execute_sql(
                'DELETE FROM %s WHERE %s' % (self._quote(source), where),
                ids)
        return cursor.rowcount

    def count(self):
        """
        Return the number of archived rows.
        """
        if not self.database.table_exists(self.table_name):
            self.create_table()
        cursor = self.database.execute_sql(
            'SELECT COUNT(*) FROM %s' % self._quote(self.table_name))
        return cursor.fetchone()[0]
