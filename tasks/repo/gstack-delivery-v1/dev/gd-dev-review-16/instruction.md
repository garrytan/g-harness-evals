A teammate opened a change on branch `feature/95a963` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add iter_ranges and format_ranges for page-range specs**

Adds two functions to `more_itertools/more.py` for the range specs that print dialogs and command-line flags accept, such as `1-3, 7, 10-12`. `iter_ranges(spec, limit=10_000)` returns an iterator over the numbers a spec names: parts are separated by commas, whitespace around a part is ignored and empty parts are skipped, and each part is a number or two numbers joined by `-` (both ends included), written with the ASCII digits 0 to 9 only. Numbers come out in the order the spec names them, each one once. Specs usually come from users, so the whole spec is checked when `iter_ranges` is called and a bad spec raises ValueError right there, before any number is produced. A spec is bad if a part is not a number or range, if a range ends below its start (`3-3` is fine), or if its parts name more than `limit` numbers in total, counting a number again each time a part names it. `format_ranges(iterable)` goes the other way: it takes non-negative integers in any order, with repeats, and writes runs of three or more consecutive integers as `start-end` and the others one by one, in increasing order (`[3, 1, 2, 7, 9, 10]` gives `1-3,7,9,10`). It accepts only integers (anything with `__index__`): a negative one raises ValueError, and a float, string or other object raises TypeError. Includes type stubs and tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
