import asyncio

import cachetools
import cachetools.aio


def test_joining_a_call_in_progress_counts_as_a_hit():
    @cachetools.aio.cached(cachetools.LRUCache(10), info=True)
    async def slow(n):
        await asyncio.sleep(0.01)
        return n

    async def main():
        return await asyncio.gather(slow(1), slow(1), slow(1))

    assert asyncio.run(main()) == [1, 1, 1]
    info = slow.cache_info()
    assert (info.hits, info.misses) == (2, 1)
