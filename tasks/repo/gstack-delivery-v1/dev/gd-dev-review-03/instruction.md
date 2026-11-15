A teammate opened a change on branch `feature/6f13e4` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add Bottle.static() to serve a directory**

Adds `app.static(prefix, root, index='index.html', cache_max_age=None, follow_symlinks=False, **options)`, so a directory can be served under a URL prefix without writing the route by hand. Files go out through `static_file()`, so 404, HEAD, Range and conditional requests work as before, and the extra keyword arguments (`mimetype`, `download`, `charset`, `headers`) are passed on to it on every request. Hidden files and directories, any path segment starting with a dot, answer 404. Unless `follow_symlinks=True`, anything that resolves outside `root`, through a symlink or otherwise, answers 403. A directory is answered with its index file (404 with `index=None`). A directory URL without the trailing slash is redirected to the same URL with it, query string included, and this also works when the app is mounted under a path. Index pages are sent with `Cache-Control: no-cache`; other files get `max-age=<cache_max_age>` when it is set and no Cache-Control otherwise. `root` must be an existing directory: if not, `static()` raises ValueError and the app is left unchanged. Includes tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
