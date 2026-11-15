import asyncio
import operator
import unittest

import cachetools
import cachetools.aio


class CachedTest(unittest.IsolatedAsyncioTestCase):
    async def test_cached(self):
        calls = []

        @cachetools.aio.cached(cachetools.LRUCache(10), info=True)
        async def double(n):
            calls.append(n)
            await asyncio.sleep(0)
            return 2 * n

        self.assertEqual(2, await double(1))
        self.assertEqual(2, await double(1))
        self.assertEqual(4, await double(2))
        self.assertEqual([1, 2], calls)
        self.assertEqual((1, 2, 10, 2), tuple(double.cache_info()))
        double.cache_clear()
        self.assertEqual((0, 0, 10, 0), tuple(double.cache_info()))

    async def test_concurrent_calls_share_one_call(self):
        calls = []

        @cachetools.aio.cached(cachetools.LRUCache(10))
        async def slow(n):
            calls.append(n)
            await asyncio.sleep(0.01)
            return n

        self.assertEqual([1, 1, 2], await asyncio.gather(slow(1), slow(1), slow(2)))
        self.assertEqual([1, 2], calls)

    async def test_exception(self):
        @cachetools.aio.cached(cachetools.LRUCache(10))
        async def fail(n):
            raise ValueError(n)

        with self.assertRaises(ValueError):
            await fail(1)
        self.assertEqual(0, len(fail.cache))

    async def test_value_too_large(self):
        @cachetools.aio.cached(cachetools.LRUCache(1, getsizeof=len))
        async def chars(n):
            return "x" * n

        self.assertEqual("xxx", await chars(3))
        self.assertEqual(0, len(chars.cache))

    def test_not_a_coroutine_function(self):
        with self.assertRaises(TypeError):
            cachetools.aio.cached(cachetools.LRUCache(10))(len)
        with self.assertRaises(TypeError):
            cachetools.aio.cached(None)


class Client:
    def __init__(self, name):
        self.name = name
        self.cache = cachetools.LRUCache(10)
        self.calls = 0

    @cachetools.aio.cachedmethod(operator.attrgetter("cache"))
    async def get(self, n):
        self.calls += 1
        await asyncio.sleep(0)
        return (self.name, n)


class CachedMethodTest(unittest.IsolatedAsyncioTestCase):
    async def test_cachedmethod(self):
        client = Client("a")
        self.assertEqual(("a", 1), await client.get(1))
        self.assertEqual(("a", 1), await client.get(1))
        self.assertEqual(1, client.calls)
        self.assertEqual(
            [("a", 2), ("a", 2)], await asyncio.gather(client.get(2), client.get(2))
        )
        self.assertEqual(2, client.calls)
        Client.get.cache_clear(client)
        self.assertEqual(0, len(client.cache))
