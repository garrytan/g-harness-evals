A teammate opened a change on branch `feature/92c5b4` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add playhouse.query_args for list endpoints**

Adds `apply_args(query, args, fields, search=None, per_page=20, max_per_page=100)` in `playhouse/query_args.py`, so a list view can hand its query string straight to peewee: `<field>=<value>` and `<field>__<op>=<value>` filter (eq, ne, lt, lte, gt, gte with their usual meaning, `in` with a comma-separated list, `isnull` with true or false), `q` keeps the rows where any of the `search` fields contains the text ignoring case, with the text matched literally, `sort` takes comma-separated field names with `-` for descending, and `page` (from 1) and `per_page` paginate. The arguments come from the client, so only the fields the view lists in `fields` can be filtered or sorted on, `per_page` never goes above `max_per_page`, and anything else raises `ValueError` for the view to turn into a 400. Empty values are ignored, since browsers send empty form fields. Includes tests in `tests/query_args.py`.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
