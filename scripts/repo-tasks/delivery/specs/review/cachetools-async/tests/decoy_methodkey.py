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
        return (self.user, n)


def test_each_instance_has_its_own_results():
    alice, bob = Session("alice"), Session("bob")

    async def main():
        return [await alice.profile(1), await bob.profile(1), await alice.profile(1)]

    assert asyncio.run(main()) == [("alice", 1), ("bob", 1), ("alice", 1)]
