"""
A storage that keeps each table of the database in its own JSON file.

All files live in one directory, one per table, named after the table with a
``.json`` suffix. This keeps diffs of a database under version control
small, and lets a large database rewrite only what it stores.
"""

import json
import os
import tempfile
from typing import Any, Optional
from urllib.parse import quote, unquote

from .storages import Storage

__all__ = ('DirectoryStorage',)

SUFFIX = '.json'


def _encode(name: str) -> str:
    """
    The file name of a table. Every character that is not safe in a file
    name is percent-encoded, so any table name gives a single file name.
    """
    return quote(name, safe='') + SUFFIX


def _decode(entry: str) -> str:
    """
    The table name of a file name, the reverse of :func:`_encode`. The file
    name must end with the suffix.
    """
    return unquote(entry[:-len(SUFFIX)])


class DirectoryStorage(Storage):
    """
    Store each table in its own JSON file inside a directory.
    """

    def __init__(self, path: str, create_dirs: bool = True,
                 read_only: bool = False, encoding: str = 'utf-8', **kwargs):
        """
        Create a new instance.

        :param path: The directory that holds the table files.
        :param create_dirs: Whether to create the directory if it does not
            exist yet.
        :param read_only: Never create or change anything on disk.
        :param encoding: The encoding of the table files.
        :param kwargs: Passed to ``json.dumps`` for every table.
        """

        super().__init__()

        self._path = path
        self._read_only = read_only
        self._encoding = encoding
        self.kwargs = kwargs

        if not os.path.isdir(path):
            if not create_dirs:
                raise FileNotFoundError(path)
            os.makedirs(path)

    def read(self) -> Optional[dict[str, dict[str, Any]]]:
        tables = self._tables()
        if not tables:
            return None

        data = {}
        for name, file in tables.items():
            with open(file, encoding=self._encoding) as handle:
                data[name] = json.load(handle)
        return data

    def write(self, data: dict[str, dict[str, Any]]) -> None:
        if self._read_only:
            raise IOError('Cannot write to the database. It is read only.')

        serialized = {name: json.dumps(docs, **self.kwargs)
                      for name, docs in data.items()}
        for name, text in serialized.items():
            self._replace(os.path.join(self._path, _encode(name)), text)

        for name, file in self._tables().items():
            if name not in data:
                os.remove(file)

        self._sync()

    def _replace(self, file: str, text: str) -> None:
        """
        Replace a file with new contents, through a temporary file in the same
        directory, so that the file has either its old or its new contents.
        """
        fd, tmp = tempfile.mkstemp(dir=self._path, prefix='.', suffix='.tmp')
        try:
            with open(fd, 'w', encoding=self._encoding) as handle:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, file)
        except OSError:
            os.remove(tmp)
            raise

    def _tables(self) -> dict[str, str]:
        """
        Map the name of every table in the directory to its file.
        """
        tables = {}
        for entry in sorted(os.listdir(self._path)):
            if not entry.startswith('.'):
                tables[_decode(entry)] = os.path.join(self._path, entry)
        return tables

    def _sync(self) -> None:
        """
        Make the renames and removals in the directory durable. Not every
        platform can open or sync a directory, and there the files are still
        complete.
        """
        try:
            fd = os.open(self._path, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        except OSError:
            pass
