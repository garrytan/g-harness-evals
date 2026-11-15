A teammate opened a change on branch `feature/783897` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add a storage that keeps each table in its own file**

Adds `DirectoryStorage` (`tinydb/directory_storage.py`), which keeps a database as a directory with one JSON file per table instead of one big file, so a database under version control gets small diffs. A table's file is its name with every character that is not safe in a file name percent-encoded, plus `.json`, so any table name works and every file stays inside the directory; reading decodes the name back exactly. Each file is replaced through a temporary file in the same directory, and a write that fails (for example because a document cannot be serialized) leaves every file as it was. Tables that are gone from the database have their files removed; other files in the directory are not the storage's and are left alone. The directory is created when missing, unless `create_dirs=False`, and `read_only=True` never creates or changes anything on disk. Includes tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
