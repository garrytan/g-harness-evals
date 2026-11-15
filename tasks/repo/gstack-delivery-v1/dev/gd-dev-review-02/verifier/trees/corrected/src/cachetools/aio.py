"""Memoizing decorators for coroutine functions."""

__all__ = ("cached", "cachedmethod")

import asyncio
import functools
import inspect

from . import CacheInfo, keys


async def _run(calls, cache, key, func, /, *args, **kwargs):
    try:
        value = await func(*args, **kwargs)
    finally:
        del calls[key]
    try:
        cache[key] = value
    except ValueError:
        pass  # value too large
    return value


async def _join(calls, key, start):
    try:
        task = calls[key]
    except KeyError:
        task = calls[key] = asyncio.ensure_future(start())
    return await asyncio.shield(task)


def _check(func):
    if not inspect.iscoroutinefunction(func):
        raise TypeError(f"{func!r} is not a coroutine function")


def cached(cache, key=keys.hashkey, info=False):
    """Decorator to wrap a coroutine function with a memoizing callable
    that saves results in a cache.

    Concurrent calls with the same key share a single call of the
    wrapped function.

    """
    if cache is None:
        raise TypeError("cache must not be None")

    def decorator(func):
        _check(func)

        def cache_clear():
            nonlocal hits, misses
            cache.clear()
            hits = misses = 0

        calls = {}
        hits = misses = 0

        async def wrapper(*args, **kwargs):
            nonlocal hits, misses
            k = key(*args, **kwargs)
            try:
                result = cache[k]
            except KeyError:
                pass  # key not found
            else:
                hits += 1
                return result
            if k in calls:
                hits += 1
            else:
                misses += 1
            start = functools.partial(_run, calls, cache, k, func, *args, **kwargs)
            return await _join(calls, k, start)

        def cache_info():
            """Return the cache statistics."""
            return CacheInfo._make_info(cache, hits, misses)

        # update first, so func.__dict__ cannot override wrapper state,
        # e.g. when stacking decorators
        functools.update_wrapper(wrapper, func)
        wrapper.cache = cache
        wrapper.cache_key = key
        wrapper.cache_clear = cache_clear
        if info:
            wrapper.cache_info = cache_info
        return wrapper

    return decorator


def cachedmethod(cache, key=keys.methodkey):
    """Decorator to wrap a coroutine method with a memoizing callable
    that saves results in a per-instance cache.

    `cache` is called with the instance and returns its cache.

    """

    def decorator(method):
        _check(method)
        pending = {}

        async def wrapper(self, *args, **kwargs):
            c = cache(self)
            k = key(self, *args, **kwargs)
            try:
                return c[k]
            except KeyError:
                pass  # key not found
            calls = pending.setdefault(id(c), {})
            start = functools.partial(_run, calls, c, k, method, self, *args, **kwargs)
            return await _join(calls, k, start)

        def cache_clear(self):
            cache(self).clear()

        functools.update_wrapper(wrapper, method)
        wrapper.cache = cache
        wrapper.cache_key = key
        wrapper.cache_clear = cache_clear
        return wrapper

    return decorator
