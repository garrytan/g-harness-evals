import asyncio
import operator

import cachetools
import cachetools.aio


class Session:
    def __init__(self, user):
        self.user = user
        self.cache = cachetools.LRUCache(10)

    @cachetools.aio.cachedmethod(operator.attrgetter("cache"))
    async def profile(self, n):
        await asyncio.sleep(0.01)
        return {"user": self.user, "n": n}


def test_concurrent_calls_on_two_instances_stay_separate():
    alice, bob = Session("alice"), Session("bob")

    async def main():
        return await asyncio.gather(alice.profile(1), bob.profile(1))

    a, b = asyncio.run(main())
    assert a["user"] == "alice"
    assert b["user"] == "bob"
    assert bob.cache[cachetools.keys.methodkey(bob, 1)]["user"] == "bob"
