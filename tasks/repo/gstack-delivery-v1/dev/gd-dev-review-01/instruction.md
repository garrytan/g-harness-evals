A teammate opened a change on branch `feature/c7e9df` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Export tables as a small HTML site**

Adds `tabulate.export.export_html(directory, tables, captions=None, title="Tables", headers="keys")`, which writes a set of named tables as a small static site: one `<name>.html` page per table and an `index.html` that links them in the order given. `tables` maps each name to anything `tabulate()` accepts, and `headers` is used for every table. A table's caption (from `captions`, defaulting to its name) is the heading of its page and the tooltip of its link in the index, and each link also shows the table's number of data rows. Cell text, captions and the title are escaped, as with tabulate's `html` format, so the pages are safe to publish whatever the data holds. A name may only contain letters, digits, `_`, `-` and `.` and must start with a letter or a digit, so every page lands directly inside `directory`; if any name is invalid, `export_html` raises ValueError before it creates or writes anything. Returns the paths it wrote, the index last. Includes tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
