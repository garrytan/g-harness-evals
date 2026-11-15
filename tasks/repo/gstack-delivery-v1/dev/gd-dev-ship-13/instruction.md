Your teammate's branch `feature/8d08a8` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Acronym support, as in Rails: register an acronym once and camelize, underscore, humanize and titleize keep it spelled the way it was registered.

How it should behave:
- `inflection.acronym(word)` registers an acronym such as `API`, `SSL` or `PhD`, spelled as it should appear. A word matches an acronym whatever its case.
- `camelize` writes each underscore-separated word that matches an acronym in the acronym's spelling and capitalizes the other words as it does on main (`api_key` becomes `APIKey`). With `uppercase_first_letter=False`, a leading acronym is written all in lowercase (`api_key` becomes `apiKey`).
- `underscore` treats an acronym, spelled as registered, inside a CamelCase word as one word (`PhDThesis` becomes `phd_thesis`). When registered acronyms overlap, the longest one wins: with `HTTP` and `HTTPS` registered, `HTTPSProxy` becomes `https_proxy`.
- `humanize` and `titleize` write acronyms in their registered spelling: `humanize("ssl_error")` is `SSL error` and `titleize("api_key")` is `API Key`.
- With no acronyms registered, every function behaves as it does on main.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
