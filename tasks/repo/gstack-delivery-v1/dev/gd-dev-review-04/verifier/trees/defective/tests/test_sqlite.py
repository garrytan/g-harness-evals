import os
import tempfile
import unittest

import cachetools
from cachetools.sqlite import SQLiteCache


class Timer:
    def __init__(self):
        self.time = 0

    def __call__(self):
        return self.time


class SQLiteCacheTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmpdir.name, "cache.db")

    def tearDown(self):
        self.tmpdir.cleanup()

    def cache(self, maxsize, **kwargs):
        cache = SQLiteCache(self.path, maxsize, **kwargs)
        self.addCleanup(cache.close)
        return cache

    def test_mapping(self):
        cache = self.cache(10)
        self.assertEqual(0, len(cache))
        cache[1] = "a"
        cache[(2, "x")] = ["b"]
        self.assertEqual("a", cache[1])
        self.assertEqual(["b"], cache[(2, "x")])
        self.assertIn(1, cache)
        self.assertNotIn(3, cache)
        self.assertEqual(2, len(cache))
        del cache[1]
        self.assertNotIn(1, cache)
        with self.assertRaises(KeyError):
            cache[1]
        with self.assertRaises(KeyError):
            del cache[1]
        self.assertEqual(["b"], cache.pop((2, "x")))
        self.assertEqual(0, len(cache))

    def test_maxsize(self):
        cache = self.cache(2)
        self.assertEqual(2, cache.maxsize)
        cache[1] = 1
        cache[2] = 2
        cache[3] = 3
        self.assertEqual(2, len(cache))
        self.assertEqual([2, 3], list(cache))

    def test_invalid_maxsize(self):
        with self.assertRaises(ValueError):
            SQLiteCache(self.path, 0)

    def test_persistence(self):
        cache = SQLiteCache(self.path, 10)
        cache["key"] = {"value": 1}
        cache.close()
        cache = self.cache(10)
        self.assertEqual({"value": 1}, cache["key"])

    def test_tables(self):
        first = self.cache(10)
        second = self.cache(10, table="other")
        first[1] = "first"
        second[1] = "second"
        self.assertEqual("first", first[1])
        self.assertEqual("second", second[1])
        first.clear()
        self.assertEqual(0, len(first))
        self.assertEqual(1, len(second))

    def test_ttl(self):
        timer = Timer()
        cache = self.cache(10, ttl=10, timer=timer)
        self.assertEqual(10, cache.ttl)
        cache[1] = 1
        timer.time = 5
        cache[2] = 2
        self.assertEqual(1, cache[1])
        timer.time = 12
        self.assertNotIn(1, cache)
        self.assertEqual(2, cache[2])
        self.assertEqual(1, len(cache))
        timer.time = 20
        cache.expire()
        self.assertEqual(0, len(cache))

    def test_cached(self):
        calls = []

        @cachetools.cached(self.cache(10), info=True)
        def square(n):
            calls.append(n)
            return n * n

        self.assertEqual(4, square(2))
        self.assertEqual(4, square(2))
        self.assertEqual(9, square(3))
        self.assertEqual([2, 3], calls)
        self.assertEqual(1, square.cache_info().hits)
        self.assertEqual(2, square.cache_info().currsize)
