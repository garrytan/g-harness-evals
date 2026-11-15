"""Persistent cache stored in an SQLite database."""

__all__ = ("SQLiteCache",)

import collections.abc
import pickle
import sqlite3
import time

_LIVE = "expires IS NULL OR expires >= ?"


class SQLiteCache(collections.abc.MutableMapping):
    """Least Recently Used (LRU) cache implementation stored in an
    SQLite database table.

    Keys and values are pickled, and keys are matched by their pickled
    form.  Several caches may share one database file, each in its own
    table.  If `ttl` is given, an item expires `ttl` seconds after it
    was stored, as measured by `timer`.

    """

    def __init__(self, path, maxsize, table="cache", ttl=None, timer=time.time):
        if maxsize < 1:
            raise ValueError("maxsize must be positive")
        self.__maxsize = maxsize
        self.__ttl = ttl
        self.__timer = timer
        self.__table = '"%s"' % table.replace('"', '""')
        self.__conn = sqlite3.connect(path, isolation_level=None)
        self.__execute(
            "CREATE TABLE IF NOT EXISTS {table} ("
            "key BLOB PRIMARY KEY, value BLOB NOT NULL, "
            "used INTEGER NOT NULL, expires REAL)"
        )

    def __repr__(self):
        return "%s(maxsize=%r, currsize=%r)" % (
            type(self).__name__,
            self.__maxsize,
            len(self),
        )

    def __execute(self, sql, params=()):
        return self.__conn.execute(sql.format(table=self.__table), params)

    def __getitem__(self, key):
        k = pickle.dumps(key)
        row = self.__execute(
            "SELECT value FROM {table} WHERE key = ? AND " + _LIVE,
            (k, self.__timer()),
        ).fetchone()
        if row is None:
            raise KeyError(key)
        self.__touch(k)
        return pickle.loads(row[0])

    def __iter__(self):
        rows = self.__execute(
            "SELECT key FROM {table} WHERE " + _LIVE + " ORDER BY used",
            (self.__timer(),),
        ).fetchall()
        return (pickle.loads(row[0]) for row in rows)

    def __len__(self):
        (count,) = self.__execute(
            "SELECT COUNT(*) FROM {table} WHERE " + _LIVE, (self.__timer(),)
        ).fetchone()
        return count

    def __contains__(self, key):
        try:
            self[key]
        except KeyError:
            return False
        return True

    def __delitem__(self, key):
        if key not in self:
            raise KeyError(key)
        self.__execute("DELETE FROM {table} WHERE key = ?", (pickle.dumps(key),))

    def __setitem__(self, key, value):
        k = pickle.dumps(key)
        v = pickle.dumps(value)
        now = self.__timer()
        self.expire(now)
        self.__evict(k)
        self.__execute(
            "INSERT OR REPLACE INTO {table} (key, value, used, expires) "
            "VALUES (?, ?, (SELECT COALESCE(MAX(used), 0) + 1 FROM {table}), ?)",
            (k, v, None if self.__ttl is None else now + self.__ttl),
        )

    @property
    def maxsize(self):
        """The maximum number of items in the cache."""
        return self.__maxsize

    @property
    def ttl(self):
        """The time-to-live value of the cache's items."""
        return self.__ttl

    def expire(self, time=None):
        """Remove expired items from the cache."""
        if time is None:
            time = self.__timer()
        self.__execute("DELETE FROM {table} WHERE expires <= ?", (time,))

    def clear(self):
        self.__execute("DELETE FROM {table}")

    def close(self):
        """Close the database connection."""
        self.__conn.close()

    def __evict(self, key):
        (count,) = self.__execute(
            "SELECT COUNT(*) FROM {table} WHERE key != ?", (key,)
        ).fetchone()
        if count >= self.__maxsize:
            self.__execute(
                "DELETE FROM {table} WHERE key IN (SELECT key FROM {table} "
                "WHERE key != ? ORDER BY used LIMIT ?)",
                (key, count - self.__maxsize + 1),
            )

    def __touch(self, key):
        self.__execute(
            "UPDATE {table} SET used = (SELECT MAX(used) + 1 FROM {table}) "
            "WHERE key = ?",
            (key,),
        )
