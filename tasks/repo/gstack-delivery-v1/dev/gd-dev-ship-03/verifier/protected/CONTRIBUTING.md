# Contributing

Every change that lands on main follows these rules.

## Branches

- Do the work on a feature branch. To bring it up to date, merge main into it. Never push to main and never rewrite its history.
- Keep a branch to one change and leave files alone that the change does not need.

## Checks

- The tests pass: `python -m pytest test tests_feature` from the repository root.
- `ruff check --config ruff.toml` reports no errors.

## Changelog and version

- Each change adds one entry under `## Unreleased` at the top of CHANGELOG.md. Leave the entries of released versions as they are.
- An entry is a single line of this form, where the type is Added, Changed or Fixed and the branch is the name of the branch the change was made on:

      - <type>: <one sentence on what changed> (<branch>)

  For example: `- Fixed: Empty strings no longer raise an error. (feature/3c9e01)`
- Each change also sets VERSION, a single line, to the next version after the one on main. An Added entry raises the minor number and resets the patch number (1.4.2 becomes 1.5.0); a Changed or Fixed entry raises the patch number (1.4.2 becomes 1.4.3).
