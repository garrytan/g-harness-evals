Your teammate's branch `feature/cd2c5a` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Add `to_records()`, which turns any table that tabulate accepts into a list of dicts, for code that wants the rows tabulate would print as plain data (to dump them as JSON, for example).

How it should behave:
- `tabulate.to_records(tabular_data, headers="keys")` takes the same data and `headers` as `tabulate()` and returns a list with one dict per data row, in order. An empty table, or `None`, gives `[]`.
- The keys are the column headers that `tabulate()` would print for the same `headers`, as strings: with `"keys"` the dict keys or the column numbers (`"0"`, `"1"`, ...), with `"firstrow"` the first row, with a list its items.
- Values come back exactly as given, with no number parsing or formatting: `"007"` stays `"007"` and `None` stays `None`.
- A row with fewer cells than there are headers gets `None` for each missing column.
- Separating lines (`SEPARATING_LINE` rows) are left out.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
