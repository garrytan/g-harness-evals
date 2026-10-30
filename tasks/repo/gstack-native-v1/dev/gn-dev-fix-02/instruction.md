The repository at /work/repo is a Python library. A user filed the report below. Fix the underlying bug in the library so the report is resolved, without breaking existing behaviour or tests.

### `camelize` changes behavior when an optional capitalization flag is `None`

Our configuration can supply `None` for the capitalization flag. Previously this selected lowerCamelCase, just like `False`:

```python
from inflection import camelize

print(camelize('device_type', uppercase_first_letter=None))
```

Expected: `deviceType`

Actual: `DeviceType`

Passing `False` explicitly still gives `deviceType`. Please preserve the previous behavior for callers passing `None` without changing the normal default behavior.
