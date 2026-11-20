# TLRUCache: overwriting a key with an already-expired ttu leaves the old value readable

**Describe the bug**
When `TLRUCache.__setitem__` computes a `ttu(key, value, now)` that is already in the past, it skips storing the new item — but if the key already holds a live value, that **previous value stays readable**. The assignment appears to succeed (no error), yet `key in cache` is still `True` and `cache[key]` returns the value you just overwrote.

The relevant code (`src/cachetools/__init__.py`, `TLRUCache.__setitem__`):
```python
expires = self.__ttu(key, value, time)
if not (time < expires):
    return  # skip expired items
```
The early `return` skips storing the new value (correct) but never invalidates the existing entry, so the old value survives an assignment that looked successful.

Why this is a bug and not just "expired items aren't stored":
- The sibling `TTLCache` does the opposite — it stores then expires, so a `ttl=0` overwrite replaces the old value and subsequent reads raise `KeyError`. `TLRUCache` alone resurrects the previous value; the two timed caches are inconsistent.
- It's a real hazard in the documented value-derived-ttu pattern (e.g. a ttu read from a token/record's own expiry): re-inserting an already-expired credential leaves the stale one being served.

**Expected result**
After `c["k"] = -5` (a ttu already in the past), the key is not stored: `"k" in c` is `False` and `c.get("k")` is `None`.

**Actual result**
`"k" in c` is `True` and `c.get("k")` returns `100` — the value that was just overwritten.

**Reproduction steps**

```python
from cachetools import TLRUCache

t = [0.0]
c = TLRUCache(maxsize=4, ttu=lambda k, v, now: now + v, timer=lambda: t[0])

c["k"] = 100          # ttu -> expires at t=100
t[0] = 1.0
assert c["k"] == 100  # live

c["k"] = -5           # ttu -> already in the past; item is "skipped"
print("k" in c)       # True   (expected: False)
print(c.get("k"))     # 100    (expected: None)  <-- stale value
```

(Repro uses a fake timer for determinism; reproduced on current `master` at v7.1.4.)

Happy to send a PR (branch + regression test ready).
