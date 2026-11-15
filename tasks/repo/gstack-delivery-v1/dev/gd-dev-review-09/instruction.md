A teammate opened a change on branch `feature/9f160b` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add replayable, a cache for functions that produce iterables**

Adds `replayable` to `more_itertools/more.py`: a decorator, usable as `@replayable` or `@replayable(maxsize=...)`, for a function that returns an iterable, typically a generator function that is slow to run. The first call with some arguments calls the function and returns an iterator over its items while recording them; once that iterator has been exhausted, later calls with equal arguments replay the recorded items and do not call the function at all. Only a run that reaches the end is recorded: if the function raises, or the iterator is closed or discarded early, nothing is kept and the next call runs the function again. Arguments match by equality, and a keyword argument never matches a positional one. A call whose arguments cannot be hashed goes straight to the function and is not recorded. At most `maxsize` results (default 128) are kept, dropping the least recently used one to make room; `maxsize=None` keeps everything, and zero or a negative `maxsize` keeps nothing, as with `functools.lru_cache`. The decorated function gets `cache_info()`, which returns `(hits, misses, currsize)`, and `cache_clear()`, which drops every recorded result and resets the counts; a run that is still going when the cache is cleared records nothing when it finishes. Includes a type stub and tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
