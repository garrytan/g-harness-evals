"""Named JMESPath expressions kept as files in a directory.

A name such as ``users/active`` is the file ``users/active.jmespath`` under
the library's root.  A file holds one expression, which may span several
lines; lines whose first non-blank character is ``#`` are comments.
"""
import os
import tempfile

from jmespath import exceptions
from jmespath import parser


EXTENSION = '.jmespath'


class UnknownQueryError(exceptions.JMESPathError):
    pass


class InvalidQueryNameError(exceptions.JMESPathError):
    pass


class QueryLibrary(object):
    def __init__(self, root):
        self.root = os.path.realpath(root)
        self._cache = {}

    def get(self, name):
        """Return the compiled expression saved under ``name``."""
        path = self._path(name)
        try:
            mtime = os.stat(path).st_mtime_ns
        except FileNotFoundError:
            raise UnknownQueryError("Unknown query: %s" % name)
        cached = self._cache.get(path)
        if cached is not None and cached[0] == mtime:
            return cached[1]
        compiled = parser.Parser().parse(_read_expression(path))
        self._cache[path] = (mtime, compiled)
        return compiled

    def search(self, name, data, options=None):
        return self.get(name).search(data, options=options)

    def _path(self, name):
        path = os.path.realpath(os.path.join(self.root, name + EXTENSION))
        if os.path.commonpath([self.root, path]) != self.root:
            raise InvalidQueryNameError(
                "Query name outside the library: %s" % name)
        return path

    def save(self, name, expression):
        """Save ``expression`` under ``name``, replacing any earlier one."""
        path = self._path(name)
        compiled = parser.Parser().parse(expression)
        self._write(path, expression + '\n')
        self._cache[path] = (os.stat(path).st_mtime_ns, compiled)
        return compiled

    def names(self):
        """Return every name in the library, sorted."""
        if not os.path.isdir(self.root):
            return []
        found = []
        for dirpath, dirnames, filenames in os.walk(self.root):
            for filename in filenames:
                if filename.endswith(EXTENSION):
                    relpath = os.path.relpath(
                        os.path.join(dirpath, filename), self.root)
                    found.append(
                        relpath[:-len(EXTENSION)].replace(os.sep, '/'))
                elif filename.startswith('.') and filename.endswith('.tmp'):
                    os.remove(os.path.join(dirpath, filename))
        return sorted(found)

    def delete(self, name):
        """Remove ``name`` and any directories that it leaves empty."""
        path = self._path(name)
        try:
            os.remove(path)
        except FileNotFoundError:
            raise UnknownQueryError("Unknown query: %s" % name)
        self._cache.pop(path, None)
        try:
            os.removedirs(os.path.dirname(path))
        except OSError:
            pass

    def _write(self, path, text):
        directory = os.path.dirname(path)
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=directory, prefix='.', suffix='.tmp')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                f.write(text)
            os.replace(tmp, path)
        except BaseException:
            os.unlink(tmp)
            raise


def _read_expression(path):
    with open(path, encoding='utf-8') as f:
        lines = [line.split('#')[0] for line in f.read().splitlines()]
    return '\n'.join(lines).strip()
