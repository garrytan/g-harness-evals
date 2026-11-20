# Copying a a user wrapper of a callable without __qualname__ raises AttributeError

Since v8.0.0, `copy.copy()` and `copy.deepcopy()` fail for a `@cached` wrapper whose wrapped callable has no `__qualname__`, for example a `functools.partial` object.

```python
import copy
import functools

import cachetools

func = cachetools.cached(cachetools.LRUCache(maxsize=2))(functools.partial(int, base=2))
print(func("101"))  # 5
copy.copy(func)  # same for copy.deepcopy(func)
```

```
  File "/usr/lib/python3.14/copy.py", line 90, in copy
    rv = reductor(4)
  File ".../cachetools/_cached.py", line 43, in __reduce__
    return self.__qualname__
           ^^^^^^^^^^^^^^^^^
AttributeError: '_BasicWrapper' object has no attribute '__qualname__'
```

With v7.3.2 both calls return the wrapper itself, since the wrapper was a plain function there. In v8.0.0 the wrapper became a class instance that defines `__reduce__` to pickle by qualified name, as `functools.lru_cache` does, and the `copy` module falls back to `__reduce__` when a class defines neither `__copy__` nor `__deepcopy__`. Wrappers of ordinary functions are not affected, because they have a `__qualname__` that resolves to the wrapper.

Expected behavior: copying and deep-copying a `@cached` wrapper returns the wrapper itself, as for functions and for `functools.lru_cache` wrappers, whatever the wrapped callable is.
