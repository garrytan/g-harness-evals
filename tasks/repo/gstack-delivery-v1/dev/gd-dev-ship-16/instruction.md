Your teammate's branch `feature/76d051` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Let the per-column options of `tabulate()` take a dict keyed by header name, so a caller can set the format or alignment of one column without counting columns.

How it should behave:
- `colalign`, `floatfmt`, `intfmt`, `missingval` and `maxcolwidths` also accept a dict that maps header names to the value for that column. The names are the headers `tabulate()` prints, so this works with a list of headers, `headers="keys"` and `headers="firstrow"`, and with an index column from `showindex`.
- Columns the dict does not name get the usual default: their normal alignment for `colalign`, `"g"` for `floatfmt`, `""` for `intfmt` and `missingval`, and no width limit for `maxcolwidths`.
- When several columns have the same header, the value applies to every one of them.
- A name that is not one of the table's headers raises `ValueError`, so a dict on a table without headers always raises.
- Lists, tuples and single values work as before.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
