Your teammate's branch `feature/473b30` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Add html_attrs() to render a dict as HTML attributes, for templates that build tags from data. It is also available inside SimpleTemplate templates.

How it should behave:
- `bottle.html_attrs(attrs)` renders the dict `attrs` as HTML attributes in the dict's order, each written as a space, the name, `="`, the escaped value and `"`: `html_attrs({'title': 'Hi', 'id': 'go'})` gives ` title="Hi" id="go"`. An empty dict gives an empty string.
- Names lose their trailing underscores and the remaining `_` become `-`: `class_` is written as `class`, `data_user_id` as `data-user-id`.
- `True` writes the bare name (` disabled`); `False` and `None` leave the attribute out. Every other value, `0` and `''` included, is written.
- A list or tuple value is joined with single spaces (`{'class_': ['btn', 'big']}` gives ` class="btn big"`); other values are converted with `str()`. Values are escaped with `html_escape()`, so `&`, `<`, `>`, `"` and `'` are replaced and everything else, line breaks and tabs included, is written as it is.
- A name that is empty after the conversion, or contains whitespace, a quote, `<`, `>`, `/`, `=` or a control character, raises `ValueError`.
- Inside SimpleTemplate templates `html_attrs` is available without an import, as in `<input{{!html_attrs(attrs)}}>`.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
