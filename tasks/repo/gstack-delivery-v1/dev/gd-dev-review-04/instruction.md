A teammate opened a change on branch `feature/c137a8` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add a persistent SQLite cache**

Adds `cachetools.sqlite.SQLiteCache`, an LRU cache kept in an SQLite file, so a function decorated with `@cached(SQLiteCache(...))` keeps its results across restarts. Each cache lives in its own table (`table`, default `"cache"`; any string is a valid name), so several caches can share one file. Keys and values are pickled and keys are matched by their pickled form; as with `shelve`, only open files you trust. `maxsize` bounds the number of items: storing a new key in a full cache evicts the least recently used item. Reading an item with `cache[key]` counts as a use, checking `key in cache` does not, and storing a new value for a key that is already in the cache never evicts another item. With `ttl`, an item expires `ttl` seconds after it was stored, by the same rule as `TTLCache`, measured with `timer` (`time.time` by default, because items outlive the process). A value that cannot be pickled raises and leaves the cache as it was. Includes tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root with `PYTHONPATH=src` and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
