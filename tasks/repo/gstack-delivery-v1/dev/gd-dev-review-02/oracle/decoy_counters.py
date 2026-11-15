import asyncio

import cachetools
import cachetools.aio


def test_counters_are_exact_under_concurrency():
    @cachetools.aio.cached(cachetools.LRUCache(100), info=True)
    async def f(n):
        await asyncio.sleep(0)
        return n

    async def main():
        await asyncio.gather(*(f(i) for i in range(50)))
        await asyncio.gather(*(f(i) for i in range(50)))

    asyncio.run(main())
    info = f.cache_info()
    assert (info.hits, info.misses, info.currsize) == (50, 50, 50)
