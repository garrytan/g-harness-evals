# zip_broadcast opens input iterables twice

`zip_broadcast()` calls `iter(obj)` to decide whether an argument is a scalar, discards that iterator, then calls `iter(obj)` again to consume the input. This opens an iterable twice. An input that permits only one opening works with `zip()` but fails with `zip_broadcast()`:

```python
from more_itertools import zip_broadcast

class SingleUseIterable:
    def __init__(self):
        self.opened = False

    def __iter__(self):
        if self.opened:
            raise RuntimeError('input already opened')
        self.opened = True
        return iter([1, 2])

print(list(zip(SingleUseIterable(), ['label', 'label'])))
# [(1, 'label'), (2, 'label')]

print(list(zip_broadcast(SingleUseIterable(), 'label')))
# RuntimeError: input already opened
```

Expected: `[(1, 'label'), (2, 'label')]`, without reopening the source. This also happens with empty inputs and with `strict=True`.

Reproduced on Linux with CPython 3.14.2 at commit `9ed3dbb0ae527230cd156d91d0af305478558fba`. Retaining the iterator obtained during scalar detection fixes the reproduction while preserving the configured scalar types and strict length checks. A patch with regression coverage is ready.

Fix this issue in /work/repo.
