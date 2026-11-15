import asyncio

import cachetools
import cachetools.aio


def test_clearing_the_cache_does_not_break_a_call_in_progress():
    async def main():
        started = asyncio.Event()
        release = asyncio.Event()

        @cachetools.aio.cached(cachetools.LRUCache(10))
        async def slow(n):
            started.set()
            await release.wait()
            return 2 * n

        first = asyncio.ensure_future(slow(1))
        second = asyncio.ensure_future(slow(1))
        await started.wait()
        slow.cache_clear()
        release.set()
        try:
            return await asyncio.wait_for(asyncio.gather(first, second), 5)
        except KeyError:
            return "failed"

    assert asyncio.run(main()) == [2, 2]
