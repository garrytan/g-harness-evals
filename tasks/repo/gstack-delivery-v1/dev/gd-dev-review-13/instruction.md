A teammate opened a change on branch `feature/31a358` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add playhouse.archive for moving old rows to an archive table**

Adds `playhouse/archive.py` with an `Archive` helper for tables that grow without bound (orders, events, logs). `Archive(Model).archive(where)` moves every row matching `where` into an archive table with the same columns and returns how many rows it moved; `restore(ids)` moves archived rows back by primary key. The archive table is named after the model's table with an `_archive` suffix unless `table_name` is given, and any name the database accepts works. Rows move in batches of `batch_size`, and each batch is copied and deleted in one transaction, so a row is never in both tables or in neither, even when a statement fails. `dry_run=True` only counts the rows that would move and leaves the database exactly as it was. A restored row whose primary key has been reused in the model's table in the meantime stays in the archive. Includes tests in `tests/archive.py`.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
