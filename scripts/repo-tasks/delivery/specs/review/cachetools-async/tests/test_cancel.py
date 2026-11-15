import asyncio

import cachetools
import cachetools.aio


def test_cancelling_one_caller_does_not_cancel_the_shared_call():
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
        first.cancel()
        await asyncio.sleep(0)
        release.set()
        try:
            return await asyncio.wait_for(second, 5)
        except asyncio.CancelledError:
            return "cancelled"

    assert asyncio.run(main()) == 2
