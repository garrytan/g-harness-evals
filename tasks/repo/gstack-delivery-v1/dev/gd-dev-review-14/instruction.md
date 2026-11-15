A teammate opened a change on branch `feature/a0d9fb` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add a library of named queries stored as files**

Adds `jmespath/library.py` so our tools can share saved queries instead of pasting expressions around. `QueryLibrary(root)` keeps each expression as a text file: the name `users/active` is the file `users/active.jmespath` under `root`. `save(name, expression)` checks that the expression parses, then writes it atomically, replacing any earlier query of that name; a save that fails leaves the saved query as it was. `get(name)` returns the compiled expression and caches it until the file changes on disk, so hand edits are picked up, and `search(name, data)` runs it. In a file, lines whose first non-blank character is `#` are comments, and the expression may span several lines. `names()` lists every query, sorted. A root that does not exist yet is an empty library: opening or reading a library never writes to disk, and the first save creates the root. `delete(name)` removes the file and any directories that become empty, but never the root. Names come from users, so a name that resolves to a file outside the root raises `InvalidQueryNameError`, and an unknown name raises `UnknownQueryError`. Includes tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
