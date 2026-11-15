A teammate opened a change on branch `feature/edf89d` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Run JMESPath filters inside SQLite**

Adds `jmespath/sqlite.py` so services that keep JSON documents in SQLite can filter them in the database instead of loading every row into Python. `where(condition, column='data')` compiles a filter condition (the part between `[?` and `]`) into a WHERE clause plus its parameters, for documents stored as JSON text in `column`. A row matches exactly when `jmespath.search('[?' + condition + ']', [document])` would keep its document. Supported: a comparison of a field or dotted path with a literal (string, number, `true`, `false` or `null`) on either side, `starts_with` and `ends_with` with a string literal, and `&&`, `||`, `!` and parentheses; a comparison only matches values of the literal's JSON type, and anything else raises `UnsupportedExpressionError`. Everything that comes from the expression reaches SQLite as a bound parameter, and table and column names are quoted, so any name works. `select(conn, table, condition, column='data')` runs the query on the caller's connection and returns the matching documents in rowid order. It only reads: committing or rolling back stays with the caller. Needs SQLite's JSON functions, built in since 3.38. Includes tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
