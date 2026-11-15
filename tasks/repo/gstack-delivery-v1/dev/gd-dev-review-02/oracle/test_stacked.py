import cachetools
import cachetools.aio


def test_stacked_decorators_keep_their_own_cache():
    inner, outer = cachetools.LRUCache(10), cachetools.LRUCache(10)

    @cachetools.aio.cached(outer)
    @cachetools.aio.cached(inner)
    async def f(n):
        return n

    assert f.cache is outer
