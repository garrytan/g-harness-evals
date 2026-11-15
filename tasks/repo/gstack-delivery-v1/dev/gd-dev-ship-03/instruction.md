Your teammate's branch `feature/1d9333` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Add best_match() for content negotiation, so a handler can pick the response type the client's Accept header prefers (also as request.best_match(offers)).

How it should behave:
- `bottle.best_match(header, offers, default=None)` returns the entry of `offers` (media types such as `application/json`) that the Accept header value `header` prefers, or `default` when the header accepts none of them.
- Each offer gets the quality of the most specific media range in the header that matches it: an exact `type/subtype` before `type/*` before `*/*`, whatever their order or quality. A range without `q` has quality 1, a `q` that is not a number counts as 0, and parameters other than `q` are ignored. Types and parameter names match without regard to case.
- An offer whose quality is 0 is never returned. So `text/html;q=0, */*` rules out `text/html` even though `*/*` matches it.
- The offer with the highest quality wins; on a tie the one listed first in `offers` wins. The offer is returned exactly as it was given.
- A missing or empty header (`None` or `''`) accepts everything: the first offer is returned, or `default` if `offers` is empty.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
