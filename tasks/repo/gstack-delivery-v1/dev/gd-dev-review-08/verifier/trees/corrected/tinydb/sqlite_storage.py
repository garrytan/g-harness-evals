"""
A storage that keeps the database in a SQLite file.

Each TinyDB table becomes one SQL table, named with the storage's prefix
followed by the TinyDB table name, holding one row per document. Several
databases can share one file as long as their prefixes differ.
"""

import json
import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional
from urllib.request import pathname2url

from .storages import Storage

__all__ = ('SQLiteStorage',)


def _quote(name: str) -> str:
    """
    Quote a name for use as an SQL identifier.
    """
    return '"' + name.replace('"', '""') + '"'


class SQLiteStorage(Storage):
    """
    Store the data in a SQLite database file.
    """

    def __init__(self, path: str, prefix: str = 'tinydb_',
                 readonly: bool = False, **kwargs):
        """
        Open (and unless ``readonly``, create) the database file.

        :param path: Where to store the database.
        :param prefix: Prefix of the SQL tables that belong to this database.
        :param readonly: Open an existing file without ever changing it.
        :param kwargs: Passed to ``json.dumps`` for every document.
        """
        super().__init__()
        if not prefix:
            raise ValueError('prefix must not be empty')
        self._prefix = prefix
        self.kwargs = kwargs
        self._conn = self._connect(path, readonly)

    def _connect(self, path: str, readonly: bool) -> sqlite3.Connection:
        """
        Open the database file, through a read-only URI if ``readonly``.
        """
        if readonly:
            uri = 'file:' + pathname2url(os.path.abspath(path)) + '?mode=ro'
            return sqlite3.connect(uri, uri=True, isolation_level=None)
        return sqlite3.connect(path, isolation_level=None)

    def close(self) -> None:
        self._conn.close()

    def read(self) -> Optional[Dict[str, Dict[str, Any]]]:
        tables = self._tables()
        if not tables:
            return None

        data = {}
        for sql_name in tables:
            rows = self._conn.execute(
                'SELECT doc_id, body FROM ' + _quote(sql_name)
                + ' ORDER BY rowid'
            )
            name = sql_name[len(self._prefix):]
            data[name] = {doc_id: json.loads(body) for doc_id, body in rows}

        return data

    def _tables(self) -> List[str]:
        """
        The SQL tables of this database, sorted by name.
        """
        pattern = (self._prefix.replace('\\', '\\\\')
                   .replace('%', '\\%')
                   .replace('_', '\\_')) + '%'
        rows = self._conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name LIKE ? ESCAPE '\\' ORDER BY name",
            (pattern,)
        )
        return [name for (name,) in rows]

    @contextmanager
    def _transaction(self) -> Iterator[None]:
        """
        Run the block in one transaction: all of it is stored, or none.
        """
        self._conn.execute('BEGIN IMMEDIATE')
        try:
            yield
        except BaseException:
            self._conn.execute('ROLLBACK')
            raise
        self._conn.execute('COMMIT')

    def write(self, data: Dict[str, Dict[str, Any]]) -> None:
        with self._transaction():
            # Tables that are gone from the database are dropped.
            for sql_name in self._tables():
                if sql_name[len(self._prefix):] not in data:
                    self._conn.execute('DROP TABLE ' + _quote(sql_name))

            for name, docs in data.items():
                table = _quote(self._prefix + name)
                self._conn.execute(
                    'CREATE TABLE IF NOT EXISTS ' + table
                    + ' (doc_id TEXT PRIMARY KEY, body TEXT NOT NULL)'
                )
                rows = [(str(doc_id), json.dumps(doc, **self.kwargs))
                        for doc_id, doc in docs.items()]

                # The table is rewritten as a whole, so documents that were
                # removed from it disappear here too.
                self._conn.execute('DELETE FROM ' + table)
                self._conn.executemany(
                    'INSERT INTO ' + table + ' (doc_id, body) VALUES (?, ?)',
                    rows
                )
