Your teammate's branch `feature/36ab48` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Add `% raw` ... `% endraw` blocks to SimpleTemplate, so a template can contain text that looks like template code (Vue or Handlebars snippets, docs about stpl) without escaping every line.

How it should behave:
- A line holding only `% raw` opens a raw block and the next line holding only `% endraw` closes it. As with other code lines, either line may be indented and may have spaces after the word, the space after `%` is optional, and with a custom `syntax` the configured line-start token takes the place of `%`.
- Everything between the two lines is written to the output exactly as it is, line breaks included: `{{ }}` expressions, `%` lines and `<% %>` blocks inside are not run. The `% raw` and `% endraw` lines write nothing themselves, not even their line break.
- A raw block inside a code block, such as between `% if show:` and `% end`, is written only when that code runs.
- Only the word `raw` on its own opens a block: lines such as `% raw = 5` or `% raw_html = "<b>"` stay ordinary Python code lines.
- A `% raw` with no `% endraw` line after it raises `bottle.StplSyntaxError` when the template is compiled (for example on the first `template()` call).

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
