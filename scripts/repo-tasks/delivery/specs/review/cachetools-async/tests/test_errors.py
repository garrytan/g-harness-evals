import asyncio

import cachetools
import cachetools.aio


def test_a_failed_call_is_not_reused():
    attempts = []

    @cachetools.aio.cached(cachetools.LRUCache(10))
    async def flaky(n):
        attempts.append(n)
        if len(attempts) == 1:
            raise ConnectionError("try again")
        return n

    async def main():
        try:
            await flaky(1)
        except ConnectionError:
            pass
        return await flaky(1)

    assert asyncio.run(main()) == 1
    assert attempts == [1, 1]
