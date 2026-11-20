# DeprecationWarnings when creating an autospec mock with a user decorations

**Describe the bug**
When using `unittest.mock.create_autospec` or `unittest.mock.patch(..., autospec=True)` to create autospec mocks of classes that include use of the `@cachedmethod` decorator, DeprecationWarnings get raised along the lines of `No '__dict__' attribute on 'NoneType' instance to cache 'bar' property.`.

I believe that the issue is happening in `cachetools._cachedmethod._DescriptorBase.__get__` where the logic to replace the descriptor instance with a wrapper in the instance dict does not take into account the inspection case where `obj` is passed in as None. I think I have a fix figured out, but haven't quite convinced myself that it is fully logically consistent with the expected behavior so I have not gotten it into a PR just yet, but wanted to get the issue logged before I submitted a PR.

**Expected result**
No warnings should be raised when autospec is applied to a decorated class.

**Actual result**
DeprecationWarnings are raised

**Reproduction steps**

```python
from cachetools import cachedmethod, Cache
from unittest.mock import create_autospec
import warnings

warnings.simplefilter("always", DeprecationWarning)

class Foo:
    _cache = Cache(maxsize=100)
    @cachedmethod(cache=lambda self: self._cache)
    def bar(cls, x):
        print(f"Calculating bar({x})")
        return x * 2
    
mock_foo = create_autospec(spec=Foo, instance=True)
```

Fix this issue in /work/repo.
