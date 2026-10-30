The repository at /work/repo is a Python library. A user filed the report below. Fix the underlying bug in the library so the report is resolved, without breaking existing behaviour or tests.

## Mixed bytes and numeric cells raise an exception

Rendering a single column containing an ASCII bytes label and an integer now fails:

```python
from tabulate import tabulate

print(tabulate([[b"item"], [42]], tablefmt="plain"))
```

I expected two rows displaying `item` and `42`. Instead, the call raises `TypeError: decoding to str: need a bytes-like object, int found` and produces no table. These mixed values come from records where text fields are returned as bytes but other fields retain their Python types.
