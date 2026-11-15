A teammate opened a change on branch `feature/1990ac` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add a SQLite storage**

Adds `SQLiteStorage` (`tinydb/sqlite_storage.py`) for people who want their database in a single SQLite file instead of JSON. Each TinyDB table becomes an SQL table named with the storage's prefix (default `tinydb_`) plus the table name, so several databases can share one file as long as their prefixes differ. A write replaces the stored state as a whole, inside one transaction. Documents come back in the order they were inserted, as with `JSONStorage`. `readonly=True` opens an existing file without ever creating or changing it. Includes tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
