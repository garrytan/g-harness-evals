Your teammate's branch `feature/ebd0af` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Add a bbcode table format so tables can be pasted into forums that use BBCode.

How it should behave:
- `tabulate(..., tablefmt="bbcode")` writes `[table]` on the first line, `[/table]` on the last, and one `[tr]...[/tr]` line per row in between, the header row first.
- Header cells are `[th]...[/th]` and data cells `[td]...[/td]`, with no padding inside the tags.
- In cell text, `&` becomes `&amp;`, `[` becomes `&#91;` and `]` becomes `&#93;`, so no cell can open or close a tag. Every other character, including `<`, `>` and quotes, is written as it is.
- A line break inside a cell is written as `[br]`.
- An empty table renders as an empty string, as with the other formats.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
