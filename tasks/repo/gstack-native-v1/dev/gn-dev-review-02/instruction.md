A teammate opened a change on branch `feature/change-158b23` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add an optional limit to job retrieval**

Add a `limit` parameter to `Scheduler.get_jobs()` and the module-level `get_jobs()` shortcut so callers can retrieve a bounded list without slicing it themselves. The limit applies after tag filtering and preserves registration order. Omitting it retains the current behavior; nonnegative limits are supported and negative limits raise `ValueError`. Includes tests for bounded retrieval, tag filtering, and the module-level shortcut.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. Run it from the repository root; it imports the package the normal way.

Report only real problems, at most 10. If you find none, write `[]`. Do not change the branch.
