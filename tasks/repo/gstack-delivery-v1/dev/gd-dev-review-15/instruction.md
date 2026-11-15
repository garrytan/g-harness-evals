A teammate opened a change on branch `feature/8e808e` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add an SQL export**

Adds `tabulate.sql` with `to_sql(tabular_data, table, headers="keys", replace=False, disable_numparse=False)` and `write_sql(path, tabular_data, table, headers="keys", replace=False)`, so a table can be loaded into SQLite or another SQL database. The output is one CREATE TABLE statement followed by INSERT statements of at most 500 rows each, and every row of the data is inserted. The data and headers are anything `tabulate()` accepts; every column needs a header, which becomes the column's name, and the column types follow the types tabulate finds: INTEGER, REAL or TEXT. Table and column names are always quoted, so any name works, including ones with spaces or quotes, and text values are written as standard SQL string literals, so any text loads back exactly as given. A row shorter than the headers gets NULL for its missing cells, and NaN and infinities, which SQL has no literal for, are written as NULL. With `replace=True` an existing table of the same name is dropped first. `write_sql` writes the same statements to a file; if the data cannot be converted it raises and the file is left as it was. Includes tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
