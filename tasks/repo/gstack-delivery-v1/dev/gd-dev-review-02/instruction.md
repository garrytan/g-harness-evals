A teammate opened a change on branch `feature/6d79c8` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add memoizing decorators for coroutine functions**

Adds `cachetools.aio` with `cached` and `cachedmethod` for `async def` functions, which the existing decorators cannot cache (they would store the coroutine object). Concurrent calls with the same key share one call of the wrapped function instead of each starting their own, and a call that joins a call in progress counts as a hit in `cache_info()`. Exceptions are not cached: if the shared call raises, every caller waiting on it gets the exception and the next call tries again. Cancelling one waiting caller does not cancel the shared call for the others. `cachedmethod` takes `cache` as a function of the instance, as in cachetools 5, and keeps each instance's results and calls in progress to that instance, so objects that serve different users (one session per user, say) never see each other's results. The wrappers expose `cache`, `cache_key`, `cache_clear` and, with `info=True`, `cache_info`, like `cachetools.cached`. Includes tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root with `PYTHONPATH=src` and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
